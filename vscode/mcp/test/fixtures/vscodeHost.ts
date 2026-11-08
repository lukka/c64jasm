import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpIntegration } from '../../../client/src/mcpIntegration';
import { C64jasmDebugSession } from '../../../client/src/c64jasmDebug';

let integration: McpIntegration;
const children = new Set<ChildProcess>();
const messages: { event: string; body?: Record<string, unknown> }[] = [];
let stage = 'activation';

export function activate(context: vscode.ExtensionContext) {
    integration = new McpIntegration(context, vscode.window.createOutputChannel('C64 MCP integration test'));
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('c64jasm-debug', {
            createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new C64jasmDebugSession())
        }),
        vscode.debug.registerDebugAdapterTrackerFactory('c64jasm-debug', {
            createDebugAdapterTracker: () => ({ onDidSendMessage: message => { if (message.type === 'event') messages.push(message); } })
        }),
        vscode.debug.onDidReceiveDebugSessionCustomEvent(async event => {
            if (event.event !== 'c64jasm:manageTerminal' || event.body.action !== 'create') return;
            const args: string[] = event.body.args;
            const child = spawn(args[0], args.slice(1), { cwd: vscode.workspace.workspaceFolders![0].uri.fsPath, stdio: 'ignore' });
            children.add(child);
            child.once('exit', () => children.delete(child));
            child.once('error', error => { void event.session.customRequest('c64jasm:terminalCreated', { error: error.message }); });
            child.once('spawn', () => { void event.session.customRequest('c64jasm:terminalCreated', { processId: child.pid }); });
        })
    );
    return { integration };
}

export async function deactivate() {
    await integration?.close();
    for (const child of children) child.kill('SIGTERM');
}

async function runTests() {
    fs.writeFileSync(process.env.C64JASM_MCP_E2E_RESULT!, 'started');
    const extension = vscode.extensions.getExtension('c64jasm-test.mcp-integration-host')!;
    const api = await extension.activate();
    const project = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const config = {
        type: 'c64jasm-debug', request: 'launch', name: 'F5 session', stopOnEntry: true,
        program: path.join(project, 'out/main.prg'), source: path.join(project, 'main.asm'),
        disasm: path.join(project, 'out/main.disasm'), vicePath: path.join(project, 'vice'), useEmbeddedCompiler: true
    };
    const clients: Client[] = [];
    const json = (result: any) => JSON.parse(result.content.find((part: any) => part.type === 'text').text);
    try {
        assert.equal(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], config), true);
        const session = vscode.debug.activeDebugSession!;
        assert.equal(session.type, 'c64jasm-debug');
        const firstPid = Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8'));
        const endpoint = await api.integration.ensureEndpoint('e2e');
        for (let index = 0; index < 2; index++) {
            const client = new Client({ name: `vscode-e2e-${index}`, version: '1' });
            clients.push(client);
            await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } } }));
            assert.equal((await client.listTools()).tools.length, 6);
        }
        const call = async (name: string, input: Record<string, unknown>) => {
            stage = `${name}: ${input.action ?? ''}`;
            const result = await clients[1].callTool({ name: `c64jasm_${name}`, arguments: input });
            assert.notEqual(result.isError, true, JSON.stringify(result));
            return result;
        };
        assert.equal(json(await call('manageDebugger', { action: 'status' })).sessionId, session.id);
        assert.equal(json(await call('manageDebugger', { action: 'start' })).reused, true);
        assert.equal(Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8')), firstPid);
        await call('manageBreakpoint', { action: 'set', filePath: config.source, line: 4, condition: 'A == $10' });
        assert.ok(vscode.debug.breakpoints.some(bp => bp instanceof vscode.SourceBreakpoint && bp.location.range.start.line === 3 && bp.condition === 'A == $10'));
        vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(config.source), new vscode.Position(5, 0)))]);
        assert.equal(json(await call('manageBreakpoint', { action: 'list' })).count, 2);
        await call('setRuntimeC64Memory', { registers: { A: 42 }, address: '$D020', values: [7] });
        const state = json(await call('getRuntimeC64Memory', { cpu: true, memory: [{ start: '$D020', end: '$D020' }] }));
        assert.equal(state.cpu.A, '0x2A');
        assert.deepEqual(state.memory[0].data, [7]);
        assert.equal(json(await call('resolveMapping', { symbol: 'entry' })).address, '0x080D');
        for (const source of ['build', 'live']) {
            assert.equal(json(await call('disassemble', { symbol: 'entry', instructionCount: 2, source })).instructionCount, 2);
        }
        // Test image delivery without replacing the user's system clipboard.
        api.integration.backend.saveScreenshot = async () => ({ clipboard: 'Not modified by integration test' });
        const images = await call('getRuntimeC64Memory', { screenshot: true, spriteImages: true });
        assert.equal((images.content as any[]).filter(part => part.type === 'image').length, 9);
        await call('manageDebugger', { action: 'stepInto' });
        await call('manageDebugger', { action: 'stepOver' });
        await call('manageDebugger', { action: 'stepOut' });
        await call('manageDebugger', { action: 'continue' });
        await call('manageDebugger', { action: 'pause' });
        assert.ok(messages.some(message => message.event === 'continued'));
        assert.ok(messages.some(message => message.event === 'stopped'));
        assert.ok(messages.some(message => message.event === 'invalidated'));
        const threads = await session.customRequest('threads');
        const stack = await session.customRequest('stackTrace', { threadId: threads.threads[0].id });
        assert.ok(stack.stackFrames.length > 0);
        await clients[0].close();
        assert.equal(json(await call('manageDebugger', { action: 'status' })).sessionId, session.id);
        process.kill(firstPid, 0);
        await call('manageDebugger', { action: 'stop' });
        assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
        const launched = json(await call('manageDebugger', {
            action: 'start', projectPath: project, sourcePath: config.source, programPath: config.program,
            disasmPath: config.disasm, vicePath: config.vicePath, stopOnEntry: true
        }));
        assert.notEqual(launched.reused, true, 'stop must complete before the next start');
        assert.equal(launched.sessionId, vscode.debug.activeDebugSession!.id);
        const secondPid = Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8'));
        stage = 'closing HTTP without stopping the new session';
        await api.integration.close();
        assert.equal(vscode.debug.activeDebugSession!.id, launched.sessionId);
        process.kill(secondPid, 0);
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        assert.throws(() => process.kill(secondPid, 0), /ESRCH/);
        fs.writeFileSync(process.env.C64JASM_MCP_E2E_RESULT!, 'passed');
    } finally {
        await Promise.allSettled(clients.map(client => client.close()));
        await vscode.debug.stopDebugging();
        await integration.close();
        for (const child of children) child.kill('SIGTERM');
    }
}

export async function run() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([runTests(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('VS Code integration test timed out.')), 60000);
        })]);
    } catch (error) {
        const outputs = messages.filter(message => message.event === 'output').slice(-12).map(message => message.body?.output).join('\n');
        fs.writeFileSync(process.env.C64JASM_MCP_E2E_RESULT!, `Stage: ${stage}\n${String((error as Error).stack ?? error)}\n${outputs}`);
        throw error;
    } finally { clearTimeout(timer); }
}
