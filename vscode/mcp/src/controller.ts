import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { C64jasmRuntime } from '../../client/src/c64jasmRuntime';
import {
    C64ToolHost, C64ToolResult, GetRuntimeC64MemoryTool, ResolveMappingTool,
    SetRuntimeC64MemoryTool, DisassembleTool, textResult, errorResult
} from '../../client/src/c64Tools';

export interface ServerOptions {
    projectPath: string;
    vicePath: string;
    useEmbeddedCompiler: boolean;
}

interface StartInput {
    action: string;
    configName?: string;
    projectPath?: string;
    programPath?: string;
    sourcePath?: string;
    disasmPath?: string;
    vicePath?: string;
    stopOnEntry?: boolean;
    useEmbeddedCompiler?: boolean;
}

interface BreakpointInput {
    action: string;
    filePath?: string;
    line?: number;
    condition?: string;
}

function readConfig(file: string): Record<string, any> {
    const errors: ParseError[] = [];
    const config = parse(fs.readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
    if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error(`Invalid configuration ${file}: ${errors.map(e => printParseErrorCode(e.error)).join(', ') || 'expected an object'}`);
    }
    return config;
}

export class C64Controller implements C64ToolHost {
    private readonly runtime = C64jasmRuntime.getInstance();
    private readonly tools = {
        c64jasm_getRuntimeC64Memory: new GetRuntimeC64MemoryTool(this),
        c64jasm_resolveMapping: new ResolveMappingTool(this),
        c64jasm_setRuntimeC64Memory: new SetRuntimeC64MemoryTool(this),
        c64jasm_disassemble: new DisassembleTool(this)
    };
    private readonly breakpoints = new Map<string, Map<number, string | undefined>>();
    private active = false;
    private projectPath: string;
    private vice: ChildProcess | undefined;
    private queue: Promise<unknown> = Promise.resolve();
    private closed = false;
    private activeRequest: AbortController | undefined;
    private stopping: Promise<void> | undefined;
    private disposing: Promise<void> | undefined;

    constructor(private readonly options: ServerOptions) {
        this.projectPath = path.resolve(options.projectPath);
        this.runtime.on('output', message => this.log(String(message)));
        this.runtime.on('end', () => { this.active = false; });
        this.runtime.on('runInTerminal', (request, _timeout, callback) => {
            const child = spawn(request.args[0], request.args.slice(1), {
                cwd: this.projectPath,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            this.vice = child;
            child.stdout?.on('data', data => this.log(data.toString()));
            child.stderr?.on('data', data => this.log(data.toString()));
            child.once('spawn', () => callback({ success: true, body: { processId: child.pid } }));
            child.once('error', error => callback({ success: false, message: `Cannot launch VICE: ${error.message}` }));
            child.once('exit', () => {
                if (this.vice === child) {
                    this.vice = undefined;
                    this.active = false;
                }
            });
        });
    }

    log(message: string): void {
        console.error(message);
    }

    requireRuntime(): C64jasmRuntime {
        if (!this.active || !this.runtime.monitor?.isConnected) {
            throw new Error('No active c64jasm debug session. Use c64jasm_manageDebugger with action "start".');
        }
        return this.runtime;
    }

    // VICE is stateful. Serialize calls so launch, writes, reads and stepping
    // cannot interleave when an MCP client submits several calls together.
    invoke(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<C64ToolResult> {
        const call = this.queue.then(async () => {
            const request = new AbortController();
            const cancel = () => request.abort(signal?.reason);
            try {
                if (this.closed) throw new Error('The MCP server is shutting down.');
                // A client may cancel while this call is still waiting in the queue.
                signal?.throwIfAborted();
                if (input.sessionId !== undefined) throw new Error('sessionId selects a VS Code session and is not supported by the standalone server.');
                signal?.addEventListener('abort', cancel, { once: true });
                this.activeRequest = request;
                if (name === 'c64jasm_manageDebugger') return await this.manageDebugger(input as unknown as StartInput, request.signal);
                if (name === 'c64jasm_manageBreakpoint') return await this.manageBreakpoint(input as unknown as BreakpointInput);
                const tool = this.tools[name as keyof typeof this.tools];
                if (!tool) throw new Error(`Unknown tool: ${name}`);
                return await (tool instanceof SetRuntimeC64MemoryTool ? tool.invoke(input, request.signal) : tool.invoke(input));
            } catch (error) {
                return errorResult(error);
            } finally {
                signal?.removeEventListener('abort', cancel);
                this.activeRequest = undefined;
            }
        });
        this.queue = call;
        return call;
    }

    private launchOptions(input: StartInput) {
        const projectPath = path.resolve(input.projectPath ?? this.options.projectPath);
        if (!fs.statSync(projectPath).isDirectory()) throw new Error(`Project directory does not exist: ${projectPath}`);
        const projectConfigPath = path.join(projectPath, 'c64jasm.json');
        const project = fs.existsSync(projectConfigPath) ? readConfig(projectConfigPath) : {};
        let launch: Record<string, any> = {};
        if (input.configName) {
            const config = readConfig(path.join(projectPath, '.vscode', 'launch.json'));
            launch = config.configurations?.find((c: Record<string, any>) => c.name === input.configName);
            if (!launch || launch.type !== 'c64jasm-debug') {
                throw new Error(`No c64jasm-debug launch configuration named "${input.configName}".`);
            }
        }
        const resolvePath = (value: string): string => {
            if (typeof value !== 'string' || !value.trim()) throw new Error('Launch paths must be non-empty strings.');
            const expanded = value.replace(/\$\{workspaceFolder\}/g, projectPath);
            if (/\$\{/.test(expanded)) throw new Error(`Unsupported launch variable in ${value}. Supply an explicit path instead.`);
            return path.resolve(projectPath, expanded);
        };
        const source = input.sourcePath ?? launch.source ?? project.source ?? 'main.asm';
        const sourcePath = resolvePath(source);
        if (!fs.statSync(sourcePath).isFile()) throw new Error(`Source file does not exist: ${sourcePath}`);
        const programPath = resolvePath(input.programPath ?? launch.program ?? `out/${path.parse(sourcePath).name}.prg`);
        if (!/\.prg$/i.test(programPath)) throw new Error('programPath must end in .prg.');
        const disasmPath = resolvePath(input.disasmPath ?? launch.disasm ?? programPath.replace(/\.prg$/i, '.disasm'));
        fs.mkdirSync(path.dirname(programPath), { recursive: true });
        fs.mkdirSync(path.dirname(disasmPath), { recursive: true });
        return {
            projectPath, sourcePath, programPath, disasmPath,
            vicePath: input.vicePath ?? launch.vicePath ?? this.options.vicePath,
            stopOnEntry: input.stopOnEntry ?? launch.stopOnEntry ?? true,
            useEmbeddedCompiler: input.useEmbeddedCompiler ?? launch.useEmbeddedCompiler ?? this.options.useEmbeddedCompiler
        };
    }

    private async waitForPause(signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (this.runtime.monitor?.isStopped()) return;
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                this.runtime.removeListener('stop', stopped);
                this.runtime.removeListener('end', ended);
                signal.removeEventListener('abort', cancelled);
            };
            const stopped = () => { cleanup(); resolve(); };
            const ended = () => { cleanup(); reject(new Error('VICE disconnected before execution stopped.')); };
            const cancelled = () => { cleanup(); reject(signal.reason); };
            const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for VICE to pause.')); }, 20000);
            this.runtime.once('stop', stopped);
            this.runtime.once('end', ended);
            signal.addEventListener('abort', cancelled, { once: true });
        });
    }

    private stopRuntime(): Promise<void> {
        this.active = false;
        // Shutdown can overlap the cleanup of a failed or cancelled launch.
        this.stopping ??= this.runtime.terminate().finally(() => { this.stopping = undefined; });
        return this.stopping;
    }

    private async manageDebugger(input: StartInput, signal: AbortSignal): Promise<C64ToolResult> {
        if (input.action === 'status') {
            return textResult(!this.active || !this.runtime.monitor?.isConnected
                ? 'No active c64jasm debug session.'
                : `Session active. State: ${this.runtime.monitor.isStopped() ? 'paused (stopped) in VICE' : 'running in VICE'}.`);
        }
        if (input.action === 'stop') {
            await this.stopRuntime();
            return textResult('Debugger stopped.');
        }
        if (input.action === 'start') {
            const launch = this.launchOptions(input);
            await this.stopRuntime();
            signal.throwIfAborted();
            this.projectPath = launch.projectPath;
            for (const file of this.breakpoints.keys()) await this.syncBreakpoints(file);
            signal.throwIfAborted();
            const cancelStart = () => this.runtime.cancelStart();
            signal.addEventListener('abort', cancelStart, { once: true });
            try {
                await this.runtime.start(launch.programPath, launch.stopOnEntry, launch.vicePath,
                    launch.sourcePath, launch.disasmPath, false, launch.useEmbeddedCompiler);
                signal.throwIfAborted();
                this.active = true;
                if (launch.stopOnEntry) await this.waitForPause(signal);
                return textResult(`Started session. Program: ${launch.programPath}. State: ${launch.stopOnEntry ? 'paused at entry' : 'running'}.`);
            } catch (error) {
                await this.stopRuntime();
                throw error;
            } finally {
                signal.removeEventListener('abort', cancelStart);
            }
        }
        const runtime = this.requireRuntime();
        switch (input.action) {
            case 'continue': await runtime.continue(); break;
            case 'pause': await runtime.pause(); await this.waitForPause(signal); break;
            case 'stepInto': case 'stepOver': case 'stepOut':
                try {
                    if (input.action === 'stepInto') await runtime.step();
                    else if (input.action === 'stepOver') await runtime.next();
                    else await runtime.stepOut();
                    await this.waitForPause(signal);
                } catch (error) {
                    // Finish cancellation before the next queued call uses the session.
                    if (signal.aborted && !this.closed && this.active) await runtime.pause();
                    throw error;
                }
                break;
            default: throw new Error(`Unknown debugger action: ${input.action}`);
        }
        return textResult(`Requested debugger ${input.action}.`);
    }

    private async syncBreakpoints(file: string): Promise<void> {
        await this.runtime.clearBreakpoints(file);
        for (const [line, condition] of this.breakpoints.get(file) ?? []) {
            await this.runtime.setBreakpoint(file, line, condition);
        }
        if (this.active) await this.runtime.verifyBreakpoints(file);
    }

    private async manageBreakpoint(input: BreakpointInput): Promise<C64ToolResult> {
        if (input.action === 'list') {
            const breakpoints = [...this.breakpoints].flatMap(([file, lines]) => [...lines].map(([line, condition]) => ({
                file, line, enabled: true, verified: this.active && this.runtime.breakpoints(file).some(bp => bp.line === line && bp.verified),
                ...(condition ? { condition } : {})
            })));
            return textResult(JSON.stringify({ count: breakpoints.length, breakpoints }, null, 2));
        }
        if (input.action === 'removeAll') {
            const count = [...this.breakpoints.values()].reduce((n, lines) => n + lines.size, 0);
            const files = [...this.breakpoints.keys()];
            this.breakpoints.clear();
            for (const file of files) await this.runtime.clearBreakpoints(file);
            return textResult(`Removed ${count} breakpoint(s).`);
        }
        if (!input.filePath || !Number.isInteger(input.line) || input.line! < 1) {
            throw new Error("'set' and 'remove' require filePath and a positive line.");
        }
        const file = path.resolve(this.projectPath, input.filePath);
        const lines = this.breakpoints.get(file) ?? new Map<number, string | undefined>();
        if (input.action === 'set') {
            lines.set(input.line!, input.condition);
            this.breakpoints.set(file, lines);
            await this.syncBreakpoints(file);
            return textResult(`Breakpoint set at ${file}:${input.line}${input.condition ? ` (condition: ${input.condition})` : ''}.`);
        }
        if (input.action === 'remove') {
            const removed = lines.delete(input.line!);
            if (removed) {
                if (!lines.size) this.breakpoints.delete(file);
                await this.syncBreakpoints(file);
            }
            return textResult(removed ? 'Removed 1 breakpoint(s).' : `No breakpoint found at ${file}:${input.line}.`);
        }
        throw new Error(`Unknown breakpoint action: ${input.action}`);
    }

    dispose(): Promise<void> {
        if (this.disposing) return this.disposing;
        this.closed = true;
        this.activeRequest?.abort(new Error('The MCP server is shutting down.'));
        this.disposing = (async () => {
            await this.stopRuntime();
            await this.queue;
            if (this.vice && this.vice.exitCode === null && this.vice.signalCode === null) this.vice.kill('SIGTERM');
            this.runtime.removeAllListeners();
        })();
        return this.disposing;
    }
}
