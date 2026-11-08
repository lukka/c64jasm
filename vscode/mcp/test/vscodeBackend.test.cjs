const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter: NodeEmitter } = require('node:events');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const esbuild = require('esbuild');

let bundle;
test.before(async () => {
    const result = await esbuild.build({
        absWorkingDir: path.resolve(__dirname, '../..'),
        stdin: { contents: "export { VSCodeToolBackend } from './client/src/vscodeToolBackend'; export { McpIntegration } from './client/src/mcpIntegration'; export { C64jasmRuntime } from './client/src/c64jasmRuntime'; export { C64jasmDebugSession } from './client/src/c64jasmDebug';", resolveDir: path.resolve(__dirname, '../..') },
        bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node20', external: ['vscode'], logLevel: 'silent'
    });
    bundle = result.outputFiles[0].text;
});

function environment(t, options = {}) {
    const disposable = callback => ({ dispose: callback ?? (() => {}) });
    class Emitter {
        callbacks = new Set();
        event = callback => { this.callbacks.add(callback); return disposable(() => this.callbacks.delete(callback)); };
        fire(value) { for (const callback of this.callbacks) callback(value); }
        dispose() { this.callbacks.clear(); }
    }
    class Uri {
        constructor(value) { this.fsPath = value; }
        toString() { return this.fsPath.includes('://') ? this.fsPath : `file://${this.fsPath}`; }
        static file(value) { return new Uri(value); }
        static parse(value) { return new Uri(value); }
    }
    class Position { constructor(line, character) { this.line = line; this.character = character; } }
    class Location { constructor(uri, position) { this.uri = uri; this.range = { start: position }; } }
    class SourceBreakpoint { constructor(location, enabled = true, condition) { Object.assign(this, { location, enabled, condition }); } }
    const events = Object.fromEntries(['start', 'active', 'terminate', 'configuration', 'folders', 'trust'].map(key => [key, new Emitter()]));
    const folder = { name: 'project', uri: Uri.file('/project'), index: 0 };
    const calls = [];
    const settings = { enableMcp: true, allowExternalMcpClients: false, disableCopilotIntegration: false, ...options.settings };
    const runtime = new NodeEmitter();
    let stopped = options.stopped ?? true;
    runtime.monitor = { isConnected: true, isStopped: () => stopped };
    runtime.cancelStart = () => calls.push(['cancelStart']);
    runtime.pause = async () => { stopped = true; runtime.emit('stop', 'pause'); };
    runtime.continue = async () => { stopped = false; runtime.emit('continue'); };
    runtime.step = runtime.next = runtime.stepOut = async () => { stopped = false; runtime.emit('continue'); stopped = true; runtime.emit('stop', 'step'); };
    runtime.retrieveMemory = async (start, end) => Buffer.alloc(end - start + 1).toString('hex');
    runtime.retrieveRegisters = async () => ({ 0: { name: 'A', byteCount: 1, value: 42 }, 1: { name: 'PC', byteCount: 2, value: 0x80d } });
    runtime.findSourceLineByAddr = () => ({ src: { path: '/project/main.asm' }, line: 4 });
    runtime.findAddressBySourceLine = () => 0x80d;
    runtime.lookupSymbol = () => ({ addr: 0x80d });
    runtime.stackTrace = async () => [];
    runtime.writeRegister = async (...args) => { calls.push(['writeRegister', ...args]); };
    runtime.writeMemoryBlock = async (...args) => { calls.push(['writeMemory', ...args]); };
    runtime.getScreenshot = async () => ({ debugWidth: 2, debugHeight: 2, bpp: 8, imageData: Buffer.alloc(4) });
    runtime.getCpuHistory = async () => [{ clock: 1n, instructionBytes: Buffer.from([0xea]), regs: {} }];
    const session = (id = 'f5') => ({
        id, name: `C64 ${id}`, type: 'c64jasm-debug', workspaceFolder: folder, configuration: { stopOnEntry: true },
        async customRequest(command, args) {
            calls.push([id, command, args]);
            if (command === 'threads') return { threads: [{ id: 1 }] };
            if (command === 'continue') await runtime.continue();
            else if (command === 'pause' || command === 'c64jasm:refreshState') await runtime.pause();
            else if (['next', 'stepIn', 'stepOut'].includes(command)) await runtime.step();
            return {};
        }
    });
    const initial = options.noSession ? undefined : session();
    const commands = new Map();
    const providers = new Map();
    const notifications = [];
    const vscode = {
        EventEmitter: Emitter, Uri, Position, Location, SourceBreakpoint,
        env: { remoteName: options.remoteName, clipboard: { writeText: async text => { calls.push(['clipboard', text]); } } },
        workspace: {
            isTrusted: options.trusted ?? true, workspaceFolders: [folder],
            getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
            onDidChangeConfiguration: events.configuration.event, onDidChangeWorkspaceFolders: events.folders.event, onDidGrantWorkspaceTrust: events.trust.event
        },
        window: {
            showWarningMessage: async (...args) => { notifications.push(args); return options.confirmCopy ? 'Copy connection details' : undefined; },
            showInformationMessage: async message => notifications.push(message)
        },
        commands: { registerCommand: (id, callback) => { commands.set(id, callback); return disposable(() => commands.delete(id)); } },
        lm: { registerMcpServerDefinitionProvider: (id, provider) => { providers.set(id, provider); return disposable(() => providers.delete(id)); } },
        McpHttpServerDefinition: class { constructor(label, uri, headers, version) { Object.assign(this, { label, uri, headers, version }); } },
        debug: {
            activeDebugSession: initial, breakpoints: [],
            onDidStartDebugSession: events.start.event, onDidChangeActiveDebugSession: events.active.event, onDidTerminateDebugSession: events.terminate.event,
            addBreakpoints: values => vscode.debug.breakpoints.push(...values),
            removeBreakpoints: values => { vscode.debug.breakpoints = vscode.debug.breakpoints.filter(value => !values.includes(value)); },
            startDebugging: async (targetFolder, configuration) => {
                calls.push(['startDebugging', targetFolder, configuration]);
                const created = session('mcp-started');
                events.start.fire(created);
                return true;
            },
            stopDebugging: async value => { calls.push(['stopDebugging', value.id]); events.terminate.fire(value); }
        }
    };
    const module = { exports: {} };
    const requireLocal = createRequire(__filename);
    vm.runInThisContext(`(function(require,module,exports){${bundle}\n})`, { filename: 'c64jasm-mcp-test.cjs' })(name => name === 'vscode' ? vscode : requireLocal(name), module, module.exports);
    const { VSCodeToolBackend, McpIntegration, C64jasmRuntime, C64jasmDebugSession } = module.exports;
    C64jasmRuntime.getInstance = () => runtime;
    const output = { appendLine() {} };
    const backend = new VSCodeToolBackend(output, runtime);
    t.after(() => backend.dispose());
    return { backend, runtime, vscode, calls, settings, commands, providers, notifications, events, folder, session, initial, McpIntegration, C64jasmDebugSession, output };
}

const json = result => JSON.parse(result.content.find(part => part.type === 'text').text);
const call = (env, name, input = {}, signal) => env.backend.invoke(`c64jasm_${name}`, input, signal);

test('MCP reuses the F5 session even when another debugger has UI focus', async t => {
    const env = environment(t);
    env.vscode.debug.activeDebugSession = { id: 'other', type: 'node' };
    env.events.active.fire(env.vscode.debug.activeDebugSession);
    assert.equal(json(await call(env, 'manageDebugger', { action: 'start' })).reused, true);
    assert.equal(json(await call(env, 'manageDebugger', { action: 'status' })).sessionId, 'f5');
    for (const action of ['pause', 'continue', 'stepInto', 'stepOver', 'stepOut']) {
        assert.notEqual((await call(env, 'manageDebugger', { action })).isError, true);
    }
    assert.equal(env.calls.some(entry => entry[0] === 'startDebugging'), false);
    assert.deepEqual(env.calls.filter(entry => entry[1] !== 'threads').map(entry => entry[1]), ['pause', 'continue', 'stepIn', 'next', 'stepOut']);
    await call(env, 'manageDebugger', { action: 'stop' });
    assert.deepEqual(env.calls.at(-1), ['stopDebugging', 'f5']);
});

test('MCP source breakpoints use the editor collection and retain conditions', async t => {
    const env = environment(t, { noSession: true });
    env.vscode.debug.addBreakpoints([new env.vscode.SourceBreakpoint(new env.vscode.Location(env.vscode.Uri.file('/project/main.asm'), new env.vscode.Position(2, 0)), false)]);
    assert.notEqual((await call(env, 'manageBreakpoint', { action: 'set', filePath: '/project/main.asm', line: 4, condition: 'A == $10' })).isError, true);
    let listed = json(await call(env, 'manageBreakpoint', { action: 'list' }));
    assert.equal(listed.count, 2);
    assert.equal(listed.breakpoints[0].enabled, false);
    assert.equal(listed.breakpoints[1].condition, 'A == $10');
    await call(env, 'manageBreakpoint', { action: 'remove', filePath: '/project/main.asm', line: 4 });
    assert.equal(env.vscode.debug.breakpoints.length, 1);
    await call(env, 'manageBreakpoint', { action: 'removeAll' });
    assert.equal(env.vscode.debug.breakpoints.length, 0);
});

test('launch uses VS Code configurations, reuses repeated starts, and rejects ambiguous workspaces', async t => {
    const env = environment(t, { noSession: true });
    const started = await call(env, 'manageDebugger', { action: 'start', configName: 'Existing launch' });
    assert.notEqual(started.isError, true, JSON.stringify(started));
    assert.equal(env.calls[0][2], 'Existing launch');
    assert.equal(json(await call(env, 'manageDebugger', { action: 'start' })).reused, true);
    assert.equal(env.calls.filter(entry => entry[0] === 'startDebugging').length, 1);
    await call(env, 'manageDebugger', { action: 'stop' });
    env.vscode.workspace.workspaceFolders.push({ name: 'second', uri: env.vscode.Uri.file('/second') });
    assert.equal((await call(env, 'manageDebugger', { action: 'start' })).isError, true);
    assert.equal((await call(env, 'manageDebugger', { action: 'start', projectPath: '/not-open' })).isError, true);
    assert.notEqual((await call(env, 'manageDebugger', { action: 'start', projectPath: '/project' })).isError, true);
});

test('stop waits for the termination event before a queued start', async t => {
    const env = environment(t);
    env.vscode.debug.stopDebugging = async () => {};
    const stopping = call(env, 'manageDebugger', { action: 'stop' });
    await new Promise(resolve => setImmediate(resolve));
    const starting = call(env, 'manageDebugger', { action: 'start' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.calls.some(entry => entry[0] === 'startDebugging'), false);
    env.events.terminate.fire(env.initial);
    assert.notEqual((await stopping).isError, true);
    // A request queued against an ended session must not switch to a new one.
    assert.equal((await starting).isError, true);
    assert.notEqual((await call(env, 'manageDebugger', { action: 'start' })).isError, true);
});

test('invalid writes have no pause side effect and multi-write requests cannot retarget a replacement F5 session', async t => {
    const env = environment(t, { stopped: false });
    const invalid = await call(env, 'setRuntimeC64Memory', { registers: { A: 999 } });
    assert.equal(invalid.isError, true);
    assert.equal(env.runtime.monitor.isStopped(), false);
    assert.equal(env.calls.length, 0);
    env.runtime.writeRegister = async (...args) => {
        env.calls.push(['writeRegister', ...args]);
        env.events.terminate.fire(env.initial);
        env.events.start.fire(env.session('replacement'));
    };
    const replaced = await call(env, 'setRuntimeC64Memory', { registers: { A: 1, X: 2 } });
    assert.equal(replaced.isError, true);
    assert.match(json(replaced).error, /session changed/);
    assert.equal(env.calls.filter(entry => entry[0] === 'writeRegister').length, 1);
    assert.equal(env.calls.some(entry => entry[0] === 'replacement'), false);
});

test('explicit targets cannot silently switch to another or a replacement session', async t => {
    const env = environment(t);
    assert.equal((await call(env, 'manageDebugger', { action: 'pause', sessionId: 'missing' })).isError, true);
    const first = call(env, 'manageDebugger', { action: 'status' });
    const queued = call(env, 'manageDebugger', { action: 'continue', sessionId: 'f5' });
    env.events.terminate.fire(env.initial);
    env.events.start.fire(env.session('replacement'));
    await first;
    assert.equal(queued && (await queued).isError, true);
    assert.equal(env.calls.length, 0);
    env.events.start.fire(env.session('second'));
    assert.equal((await call(env, 'manageDebugger', { action: 'status' })).isError, true);
});

test('shared runtime tools preserve images, CPU history, mapping, writes and debug UI refresh', async t => {
    const env = environment(t);
    env.backend.saveScreenshot = async () => ({ path: '/tmp/test.png', clipboard: 'Copied' });
    const state = await call(env, 'getRuntimeC64Memory', { cpu: true, cpuHistoryCount: 1, screenshot: true, spriteImages: true });
    assert.notEqual(state.isError, true, JSON.stringify(state));
    assert.equal(json(state).cpu.A, '0x2A');
    assert.equal(json(state).cpuHistory[0].instructionBytes, 'EA');
    assert.equal(json(state).screenshot.clipboard, 'Copied');
    assert.equal(state.content.filter(part => part.type === 'image').length, 9);
    assert.equal(Buffer.from(state.content.find(part => part.type === 'image').data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(json(await call(env, 'resolveMapping', { symbol: 'entry' })).address, '0x080D');
    const written = await call(env, 'setRuntimeC64Memory', { registers: { A: 7 }, address: '$D020', values: [2] });
    assert.equal(json(written).success, true);
    assert.ok(env.calls.some(entry => entry[0] === 'writeRegister'));
    assert.ok(env.calls.some(entry => entry[0] === 'writeMemory'));
    assert.ok(env.calls.some(entry => entry[1] === 'c64jasm:refreshState'));
});

test('requests are serialized, queued cancellation prevents mutation, disposal leaves debugger running', async t => {
    const env = environment(t);
    let release;
    env.initial.customRequest = async command => {
        if (command === 'threads') return { threads: [{ id: 1 }] };
        if (command === 'pause') await new Promise(resolve => { release = resolve; });
        return {};
    };
    const first = call(env, 'manageDebugger', { action: 'pause' });
    await new Promise(resolve => setImmediate(resolve));
    const abort = new AbortController();
    const cancelled = call(env, 'manageBreakpoint', { action: 'set', filePath: '/project/main.asm', line: 4 }, abort.signal);
    abort.abort();
    release();
    assert.notEqual((await first).isError, true);
    assert.equal((await cancelled).isError, true);
    assert.equal(env.vscode.debug.breakpoints.length, 0);
    env.backend.dispose();
    assert.equal(env.calls.some(entry => entry[0] === 'stopDebugging'), false);
    assert.equal((await call(env, 'manageDebugger', { action: 'status' })).isError, true);
});

test('MCP integration respects opt-outs/trust and shares credentials only on explicit confirmation', async t => {
    const env = environment(t, { noSession: true, settings: { disableCopilotIntegration: true }, confirmCopy: true });
    const integration = new env.McpIntegration({ extension: { packageJSON: { version: 'test' } }, subscriptions: [] }, env.output);
    t.after(() => integration.close());
    const provider = env.providers.get('c64jasm');
    assert.deepEqual(await provider.provideMcpServerDefinitions(), []);
    const command = env.commands.get('c64jasm-devtools.copyMcpConnection');
    await command();
    assert.equal(env.calls.some(entry => entry[0] === 'clipboard'), false);
    env.settings.allowExternalMcpClients = true;
    await command();
    const copied = JSON.parse(env.calls.find(entry => entry[0] === 'clipboard')[1]);
    assert.match(copied.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.match(copied.headers.Authorization, /^Bearer .+/);
    env.settings.disableCopilotIntegration = false;
    const definition = (await provider.provideMcpServerDefinitions())[0];
    assert.equal(definition.label, 'c64jasm');
    assert.deepEqual(definition.headers, {});
    const resolved = await provider.resolveMcpServerDefinition(definition);
    assert.equal(resolved.headers.Authorization, copied.headers.Authorization);
    env.settings.enableMcp = false;
    env.events.configuration.fire({ affectsConfiguration: key => key.endsWith('.enableMcp') });
    assert.deepEqual(await provider.provideMcpServerDefinitions(), []);
    env.settings.enableMcp = true;
    env.events.configuration.fire({ affectsConfiguration: key => key.endsWith('.enableMcp') });
    const replacement = await provider.resolveMcpServerDefinition();
    assert.notEqual(replacement.headers.Authorization, copied.headers.Authorization);
    env.vscode.workspace.isTrusted = false;
    assert.deepEqual(await provider.provideMcpServerDefinitions(), []);
    assert.equal(env.calls.some(entry => entry[0] === 'stopDebugging'), false);
});

test('untrusted and remote hosts never publish a local endpoint', async t => {
    const env = environment(t, { trusted: false, remoteName: 'ssh-remote' });
    const integration = new env.McpIntegration({ extension: { packageJSON: { version: 'test' } }, subscriptions: [] }, env.output);
    t.after(() => integration.close());
    assert.deepEqual(await env.providers.get('c64jasm').provideMcpServerDefinitions(), []);
    await env.commands.get('c64jasm-devtools.copyMcpConnection')();
    assert.equal(env.calls.some(entry => entry[0] === 'clipboard'), false);
});

test('debug adapter sends one response per control request and refreshes stacks/variables after MCP writes', async t => {
    const env = environment(t);
    const adapter = new env.C64jasmDebugSession();
    t.after(() => adapter.shutdown());
    const responses = [];
    const events = [];
    adapter.sendResponse = response => responses.push(response.command);
    adapter.sendEvent = event => events.push(event);
    const response = command => ({ command, seq: 1, request_seq: 1, success: true, type: 'response' });
    await adapter.continueRequest(response('continue'), { threadId: 1 });
    await adapter.nextRequest(response('next'), { threadId: 1 });
    assert.deepEqual(responses, ['continue', 'next']);
    adapter.customRequest('c64jasm:refreshState', response('c64jasm:refreshState'), {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(responses.filter(command => command === 'c64jasm:refreshState').length, 1);
    assert.ok(events.some(event => event.event === 'invalidated' && event.body.areas.includes('variables')));
});
