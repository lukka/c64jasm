import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { C64jasmRuntime } from './c64jasmRuntime';
import { C64ToolHost, C64ToolResult, GetRuntimeC64MemoryTool, ResolveMappingTool, SetRuntimeC64MemoryTool, DisassembleTool, textResult, errorResult } from './c64Tools';
import type { McpToolBackend } from './mcpServer';

function runFile(command: string, args: string[], input?: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, { timeout: 10000 }, error => error ? reject(error) : resolve());
        child.stdin?.end(input);
    });
}

export async function saveScreenshot(png: Buffer): Promise<Record<string, unknown>> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-screenshot-'));
    const file = path.join(directory, 'screen.png');
    fs.writeFileSync(file, png);
    if (vscode.env.remoteName) return { path: file, clipboard: 'Unavailable in a remote extension host' };
    try {
        switch (os.platform()) {
            case 'darwin':
                await runFile('osascript', ['-e', `set the clipboard to (read (POSIX file ${JSON.stringify(file)}) as «class PNGf»)`]);
                break;
            case 'win32':
                await runFile('powershell', ['-NoProfile', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $image = [System.Drawing.Image]::FromFile('${file.replace(/'/g, "''")}'); try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }`]);
                break;
            case 'linux':
                try { await runFile('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', file]); }
                catch { await runFile('wl-copy', ['--type', 'image/png'], png); }
                break;
            default: return { path: file, clipboard: 'Not supported' };
        }
        return { path: file, clipboard: 'Copied' };
    } catch {
        return { path: file, clipboard: 'Failed to copy; PNG file and image content are still available' };
    }
}

export class VSCodeToolBackend implements McpToolBackend, C64ToolHost, vscode.Disposable {
    private readonly sessions = new Map<string, vscode.DebugSession>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private readonly tools = {
        c64jasm_getRuntimeC64Memory: new GetRuntimeC64MemoryTool(this),
        c64jasm_resolveMapping: new ResolveMappingTool(this),
        c64jasm_setRuntimeC64Memory: new SetRuntimeC64MemoryTool(this),
        c64jasm_disassemble: new DisassembleTool(this)
    };
    private queue: Promise<unknown> = Promise.resolve();
    private readonly lifetime = new AbortController();
    private selectedSession: vscode.DebugSession | undefined;
    private requestSignal: AbortSignal | undefined;
    private requestHasWrites = false;
    private pending = 0;
    private closed = false;

    constructor(private readonly output: Pick<vscode.OutputChannel, 'appendLine'>,
        private readonly runtime: C64jasmRuntime = C64jasmRuntime.getInstance()) {
        const remember = (session: vscode.DebugSession | undefined) => {
            if (session?.type === 'c64jasm-debug') this.sessions.set(session.id, session);
        };
        remember(vscode.debug.activeDebugSession);
        this.subscriptions.push(
            vscode.debug.onDidStartDebugSession(remember),
            vscode.debug.onDidChangeActiveDebugSession(remember),
            vscode.debug.onDidTerminateDebugSession(session => this.sessions.delete(session.id))
        );
    }

    log(message: string): void { this.output.appendLine(message); }
    saveScreenshot = saveScreenshot;

    requireRuntime(): C64jasmRuntime {
        this.requestSignal?.throwIfAborted();
        if (!this.selectedSession || !this.sessions.has(this.selectedSession.id)) throw new Error('The selected c64jasm debug session has ended.');
        if (this.sessions.size !== 1) throw new Error('Only one c64jasm debug session per VS Code window is supported.');
        if (!this.runtime.monitor?.isConnected) throw new Error('The c64jasm session is active, but VICE is not connected yet.');
        const sessionId = this.selectedSession.id;
        const monitor = this.runtime.monitor;
        const signal = this.requestSignal;
        const checkTarget = () => {
            signal?.throwIfAborted();
            if (!this.sessions.has(sessionId) || this.sessions.size !== 1 || this.runtime.monitor !== monitor) {
                throw new Error('The selected c64jasm session changed during the request. No further operations were applied.');
            }
        };
        const markWrite = () => { this.requestHasWrites = true; };
        // A user can stop/restart F5 between awaited writes; never retarget the singleton.
        return new Proxy(this.runtime, {
            get(runtime, key) {
                checkTarget();
                const value = Reflect.get(runtime, key, runtime);
                return typeof value === 'function' ? (...args: unknown[]) => {
                    checkTarget();
                    if (key === 'writeRegister' || key === 'writeMemoryBlock') markWrite();
                    return value.apply(runtime, args);
                } : value;
            }
        });
    }

    invoke(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<C64ToolResult> {
        if (this.closed) return Promise.resolve(errorResult(new Error('The VS Code MCP backend is closed.')));
        if (this.pending >= 64) return Promise.resolve(errorResult(new Error('Too many queued debugger requests.')));
        // Capture the target before queuing, so changing UI focus cannot retarget a call.
        let target: vscode.DebugSession | undefined;
        try { target = this.selectSession(input, true); } catch (error) { return Promise.resolve(errorResult(error)); }
        this.pending++;
        const call = this.queue.then(async () => {
            const abort = new AbortController();
            const cancel = () => abort.abort(signal?.reason ?? this.lifetime.signal.reason);
            const timeout = setTimeout(() => abort.abort(new Error('Debugger operation timed out.')), input.action === 'start' ? 120000 : 30000);
            signal?.addEventListener('abort', cancel, { once: true });
            this.lifetime.signal.addEventListener('abort', cancel, { once: true });
            try {
                if (signal?.aborted || this.lifetime.signal.aborted) cancel();
                abort.signal.throwIfAborted();
                if (target && !this.sessions.has(target.id)) throw new Error('The selected c64jasm debug session has ended.');
                this.requestSignal = abort.signal;
                this.requestHasWrites = false;
                this.selectedSession = target;
                if (name === 'c64jasm_manageDebugger') return await this.manageDebugger(input, abort.signal);
                if (name === 'c64jasm_manageBreakpoint') return this.manageBreakpoint(input);
                this.selectedSession = target ?? this.selectSession(input);
                this.requireRuntime();
                const tool = this.tools[name as keyof typeof this.tools];
                if (!tool) throw new Error(`Unknown tool: ${name}`);
                const result = await (tool instanceof SetRuntimeC64MemoryTool ? tool.invoke(input, abort.signal) : tool.invoke(input));
                if (this.requestHasWrites && this.sessions.has(this.selectedSession.id)) {
                    await this.selectedSession.customRequest('c64jasm:refreshState');
                }
                return result;
            } catch (error) { return errorResult(error); }
            finally {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', cancel);
                this.lifetime.signal.removeEventListener('abort', cancel);
                this.selectedSession = undefined;
                this.requestSignal = undefined;
                this.requestHasWrites = false;
                this.pending--;
            }
        });
        this.queue = call.catch(() => {});
        return call;
    }

    private selectSession(input: Record<string, unknown>, optional = false): vscode.DebugSession | undefined {
        if (this.sessions.size > 1) throw new Error('Only one c64jasm debug session per VS Code window is supported.');
        let candidates = [...this.sessions.values()];
        if (input.sessionId !== undefined) {
            candidates = candidates.filter(session => session.id === input.sessionId);
            if (!candidates.length) throw new Error('The requested c64jasm sessionId does not exist in this VS Code window.');
        }
        if (input.projectPath !== undefined) {
            const folder = this.projectFolder(input);
            candidates = candidates.filter(session => session.workspaceFolder?.uri.toString() === folder?.uri.toString());
            if (!candidates.length && this.sessions.size) throw new Error('The active c64jasm session belongs to another workspace folder.');
        }
        if (!candidates.length && !optional) throw new Error('No active c64jasm debug session. Use c64jasm_manageDebugger with action "start", or press F5.');
        return candidates[0];
    }

    private projectFolder(input: Record<string, unknown>): vscode.WorkspaceFolder | undefined {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (input.projectPath !== undefined) {
            if (typeof input.projectPath !== 'string' || !path.isAbsolute(input.projectPath)) throw new Error('projectPath must be an absolute path to an open workspace folder.');
            const folder = folders.find(value => path.resolve(value.uri.fsPath) === path.resolve(input.projectPath as string));
            if (!folder) throw new Error('projectPath must select an open workspace folder in this VS Code window.');
            return folder;
        }
        if (this.selectedSession?.workspaceFolder) return this.selectedSession.workspaceFolder;
        if (folders.length > 1) throw new Error('Specify projectPath to select an open workspace folder.');
        return folders[0];
    }

    private status(session: vscode.DebugSession | undefined, reused = false): C64ToolResult {
        const state = !session ? 'inactive' : !this.runtime.monitor?.isConnected ? 'connecting' : this.runtime.monitor.isStopped() ? 'paused' : 'running';
        return textResult(JSON.stringify({
            state, message: session ? `Session active. State: ${state}.` : 'No active c64jasm debug session.',
            ...(session && { sessionId: session.id, name: session.name, projectPath: session.workspaceFolder?.uri.fsPath }),
            ...(reused && { reused: true })
        }, null, 2));
    }

    private async waitForPause(session: vscode.DebugSession, signal: AbortSignal): Promise<void> {
        while (!this.runtime.monitor?.isStopped()) {
            signal.throwIfAborted();
            if (!this.sessions.has(session.id)) throw new Error('The c64jasm debug session ended before it paused.');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        signal.throwIfAborted();
    }

    private async manageDebugger(input: Record<string, unknown>, signal: AbortSignal): Promise<C64ToolResult> {
        let session = this.selectedSession;
        if (input.action === 'status') return this.status(session);
        if (input.action === 'start') {
            session ??= this.selectSession(input, true);
            if (session) return this.status(session, true);
            const folder = this.projectFolder(input);
            let launched: vscode.DebugSession | undefined;
            const cancelStart = () => {
                if (launched) {
                    this.runtime.cancelStart();
                    void Promise.resolve(vscode.debug.stopDebugging(launched)).catch(() => {});
                }
            };
            const subscription = vscode.debug.onDidStartDebugSession(value => {
                if (value.type === 'c64jasm-debug' && value.workspaceFolder?.uri.toString() === folder?.uri.toString()) {
                    launched = value;
                    if (signal.aborted) cancelStart();
                }
            });
            signal.addEventListener('abort', cancelStart, { once: true });
            try {
                const config: vscode.DebugConfiguration = {
                    type: 'c64jasm-debug', request: 'launch', name: 'c64jasm Debug', stopOnEntry: input.stopOnEntry ?? true,
                    program: input.programPath ?? '${workspaceFolder}/main.prg',
                    ...(input.sourcePath !== undefined && { source: input.sourcePath }),
                    ...(input.disasmPath !== undefined && { disasm: input.disasmPath }),
                    ...(input.vicePath !== undefined && { vicePath: input.vicePath }),
                    ...(input.useEmbeddedCompiler !== undefined && { useEmbeddedCompiler: input.useEmbeddedCompiler })
                };
                const ok = await vscode.debug.startDebugging(folder, typeof input.configName === 'string' ? input.configName : config);
                signal.throwIfAborted();
                if (!ok) throw new Error('Failed to start the c64jasm debugger. Check the launch configuration and compiler output.');
                session = launched ?? this.selectSession(input);
                if (!session) throw new Error('VS Code did not create a c64jasm debug session.');
                this.selectedSession = session;
                const stopOnEntry = typeof input.configName === 'string' ? session.configuration.stopOnEntry === true : input.stopOnEntry !== false;
                if (stopOnEntry) await this.waitForPause(session, signal);
                return this.status(session);
            } catch (error) {
                if (signal.aborted && launched) await vscode.debug.stopDebugging(launched);
                throw error;
            } finally {
                subscription.dispose();
                signal.removeEventListener('abort', cancelStart);
            }
        }
        session ??= this.selectSession(input);
        if (!session) throw new Error('No active c64jasm debug session.');
        if (input.action === 'stop') {
            await vscode.debug.stopDebugging(session);
            while (this.sessions.has(session.id)) {
                signal.throwIfAborted();
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            return textResult('Debugger stopped.');
        }
        this.selectedSession = session;
        this.requireRuntime();
        const commands: Record<string, string> = { pause: 'pause', continue: 'continue', stepInto: 'stepIn', stepOver: 'next', stepOut: 'stepOut' };
        const action = String(input.action);
        const command = commands[action];
        if (!command) throw new Error(`Unknown debugger action: ${action}`);
        const threads = await session.customRequest('threads') as { threads: { id: number }[] };
        if (threads.threads?.length !== 1) throw new Error('Expected exactly one c64jasm CPU thread.');
        signal.throwIfAborted();
        try {
            await session.customRequest(command, { threadId: threads.threads[0].id });
            if (action !== 'continue') await this.waitForPause(session, signal);
            signal.throwIfAborted();
        } catch (error) {
            if (signal.aborted && this.sessions.has(session.id) && !this.runtime.monitor?.isStopped()) {
                await session.customRequest('pause', { threadId: threads.threads[0].id });
            }
            throw error;
        }
        return textResult(`Requested debugger ${action}.`);
    }

    private manageBreakpoint(input: Record<string, unknown>): C64ToolResult {
        const sources = () => vscode.debug.breakpoints.filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint);
        if (input.action === 'list') {
            const breakpoints = sources().map(bp => ({ file: bp.location.uri.fsPath, line: bp.location.range.start.line + 1, enabled: bp.enabled, ...(bp.condition ? { condition: bp.condition } : {}) }));
            return textResult(JSON.stringify({ count: breakpoints.length, breakpoints }, null, 2));
        }
        if (input.action === 'removeAll') {
            const breakpoints = sources();
            vscode.debug.removeBreakpoints(breakpoints);
            return textResult(`Removed ${breakpoints.length} breakpoint(s).`);
        }
        if (typeof input.filePath !== 'string' || !Number.isInteger(input.line) || Number(input.line) < 1) throw new Error("'set' and 'remove' require filePath and a positive line.");
        const folder = path.isAbsolute(input.filePath) ? undefined : this.projectFolder(input);
        if (!path.isAbsolute(input.filePath) && !folder) throw new Error('Use an absolute filePath when no workspace folder is open.');
        const uri = vscode.Uri.file(path.resolve(folder?.uri.fsPath ?? '', input.filePath));
        const position = new vscode.Position(Number(input.line) - 1, 0);
        if (input.action === 'set') {
            vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(uri, position), true, typeof input.condition === 'string' ? input.condition : undefined)]);
            return textResult(`Breakpoint set at ${uri.fsPath}:${input.line}.`);
        }
        if (input.action === 'remove') {
            const breakpoints = sources().filter(bp => bp.location.uri.fsPath === uri.fsPath && bp.location.range.start.line === position.line);
            vscode.debug.removeBreakpoints(breakpoints);
            return textResult(`Removed ${breakpoints.length} breakpoint(s).`);
        }
        throw new Error(`Unknown breakpoint action: ${input.action}`);
    }

    dispose(): void {
        this.closed = true;
        this.lifetime.abort(new Error('The VS Code MCP backend is closing.'));
        for (const subscription of this.subscriptions) subscription.dispose();
    }
}
