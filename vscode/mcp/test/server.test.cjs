const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');

const dist = path.resolve(__dirname, '../dist');
const compilerVersion = require('../../node_modules/c64jasm/package.json').version;

async function connect(t, args = [], bundle = path.join(dist, 'index.cjs')) {
    const ownProcessGroup = process.platform !== 'win32';
    const child = spawn(process.execPath, [bundle, ...args], { cwd: path.dirname(bundle), stdio: ['pipe', 'pipe', 'pipe'], detached: ownProcessGroup });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-32000); });
    const requests = new Map();
    let nextId = 1;
    const protocolErrors = [];
    readline.createInterface({ input: child.stdout }).on('line', line => {
        try {
            const message = JSON.parse(line);
            const pending = requests.get(message.id);
            if (pending) {
                requests.delete(message.id);
                if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
                else pending.resolve(message.result);
            }
        } catch (error) { protocolErrors.push(`${line}: ${error.message}`); }
    });
    const exited = once(child, 'exit');
    child.on('exit', () => {
        for (const pending of requests.values()) pending.reject(new Error(`Server exited unexpectedly.\n${stderr}`));
    });
    function notify(method, params) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params && { params }) }) + '\n');
    }
    function request(method, params, timeout = 90000) {
        const id = nextId++;
        const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                requests.delete(id);
                reject(new Error(`Timed out: ${method}\n${stderr}`));
            }, timeout);
            requests.set(id, {
                resolve: result => { clearTimeout(timer); resolve(result); },
                reject: error => { clearTimeout(timer); reject(error); }
            });
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        return Object.assign(promise, { requestId: id });
    }
    function cancel(request) {
        notify('notifications/cancelled', { requestId: request.requestId, reason: 'Cancelled by test client' });
        const pending = requests.get(request.requestId);
        requests.delete(request.requestId);
        pending?.reject(new Error('Request cancelled by test client'));
    }
    async function close(signal) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (signal) child.kill(signal);
        else child.stdin.end();
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        const [code, exitSignal] = await exited;
        clearTimeout(timer);
        assert.equal(exitSignal, null, `Server required a signal to exit: ${exitSignal}\n${stderr}`);
        assert.equal(code, 0, stderr);
        assert.deepEqual(protocolErrors, [], 'stdout must contain only JSON-RPC');
    }
    t.after(async () => {
        try { await close(); } finally {
            // A regression may crash or hang the server before it can stop its
            // children. Keep failed tests from leaving compiler/VICE processes.
            if (ownProcessGroup) {
                try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
                    if (error.code !== 'ESRCH') throw error;
                }
            }
        }
    });
    const initialized = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c64jasm-test', version: '1' } });
    assert.equal(initialized.serverInfo.name, 'c64jasm');
    notify('notifications/initialized');
    return { request, cancel, close, child, stderr: () => stderr, call: (name, args, timeout) => request('tools/call', { name, arguments: args }, timeout) };
}

function json(result) {
    return JSON.parse(result.content.find(part => part.type === 'text').text);
}

function createProject(t, options = {}) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-project-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.writeFileSync(path.join(project, 'main.asm'), '* = $0801\n!byte $0c, $08, 0, 0, $9e, $32, $30, $36, $31, 0, 0, 0\nentry:\n    lda #1\n    sta $d020\nloop:\n    jmp loop\n');
    fs.writeFileSync(path.join(project, 'vice-fixture.json'), JSON.stringify(options));
    const vice = path.join(project, 'vice');
    const fixture = path.join(__dirname, 'fixtures/vice.cjs');
    fs.writeFileSync(vice, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${fixture.replace(/'/g, "'\\''")}' "$@"\n`, { mode: 0o755 });
    return { project, vice };
}

function installPackage(t) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-installed-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const npm = (args, cwd) => {
        const result = spawnSync('npm', args, { cwd, encoding: 'utf8', timeout: 30000 });
        assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? result.stdout);
        return result.stdout;
    };
    // npm test already built dist. Pack those exact bytes without rebuilding.
    const [archive] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], path.resolve(__dirname, '..')));
    const prefix = path.join(temp, 'consumer');
    npm(['install', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, archive.filename)], temp);
    const installed = path.join(prefix, 'node_modules', 'c64jasm-devtools-mcp');
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.dependencies ?? {}, {}, 'The compiler and its dependencies must be embedded');
    assert.deepEqual(fs.readdirSync(path.join(prefix, 'node_modules')).filter(name => !name.startsWith('.')), ['c64jasm-devtools-mcp']);
    const version = spawnSync(process.execPath, [path.join(installed, 'dist', 'cli.js'), '--version'], { cwd: temp, encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), compilerVersion, 'The package must contain the same forked compiler used by the extension');
    const bin = spawnSync(path.join(prefix, 'node_modules', '.bin', 'c64jasm-devtools-mcp'), ['--version'], { cwd: temp, encoding: 'utf8' });
    assert.equal(bin.status, 0, bin.stderr);
    assert.equal(bin.stdout.trim(), manifest.version);
    return path.join(installed, 'dist', 'index.cjs');
}

async function waitForFile(file) {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(file)) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

const fixtureTests = { timeout: 40000, skip: process.platform === 'win32' && 'The fixture executable uses a POSIX shell launcher.' };

for (const scenario of [
    { name: 'rejected CIA reads during screenshots', options: { rejectMemoryAt: 0xdd00, screenshotDelayMs: 200 }, input: { screenshot: true }, error: /MEMSPACE_INVALID/ },
    { name: 'malformed memory responses', options: { malformedMemoryAt: 0xd020 }, input: { memory: [{ start: '$D020', end: '$D020' }] }, error: /response/i }
]) {
    test(`${scenario.name} return errors without blocking later calls`, fixtureTests, async t => {
        const { project, vice } = createProject(t, scenario.options);
        const client = await connect(t, ['--project', project, '--vice-path', vice]);
        assert.notEqual((await client.call('c64jasm_manageDebugger', { action: 'start' })).isError, true);
        const result = await client.call('c64jasm_getRuntimeC64Memory', scenario.input, 3000);
        assert.equal(result.isError, true);
        assert.match(json(result).error, scenario.error);
        const state = await client.call('c64jasm_getRuntimeC64Memory', { memory: [{ start: '$D021', end: '$D021' }] }, 3000);
        assert.notEqual(state.isError, true);
        assert.deepEqual(json(state).memory[0].data, [0]);
        await client.close();
    });
}

test('rejected breakpoint conditions leave no verified or unconditional breakpoint', fixtureTests, async t => {
    const { project, vice } = createProject(t, { rejectCondition: true });
    const client = await connect(t, ['--project', project, '--vice-path', vice]);
    assert.notEqual((await client.call('c64jasm_manageDebugger', { action: 'start' })).isError, true);
    const result = await client.call('c64jasm_manageBreakpoint', { action: 'set', filePath: 'main.asm', line: 4, condition: 'invalid' });
    assert.equal(result.isError, true);
    const state = json(await client.call('c64jasm_manageBreakpoint', { action: 'list' }));
    assert.equal(state.breakpoints[0].verified, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'checkpoints.json'), 'utf8')), []);
    await client.call('c64jasm_manageBreakpoint', { action: 'removeAll' });
    assert.notEqual((await client.call('c64jasm_manageBreakpoint', { action: 'set', filePath: 'main.asm', line: 4 })).isError, true);
    assert.equal(json(await client.call('c64jasm_manageBreakpoint', { action: 'list' })).breakpoints[0].verified, true);
    await client.close();
});

test('malformed BASIC SYS headers fail without hanging the server', fixtureTests, async t => {
    const { project, vice } = createProject(t);
    const client = await connect(t, ['--project', project, '--vice-path', vice]);
    for (const bytes of ['$32', '0', '$36,$35,$35,$33,$36,0']) {
        fs.writeFileSync(path.join(project, 'main.asm'), `* = $0801\n!byte $0c, $08, 0, 0, $9e, ${bytes}\n`);
        const result = await client.call('c64jasm_manageDebugger', { action: 'start' }, 5000);
        assert.equal(result.isError, true);
        assert.match(json(result).error, /BASIC SYS/);
        assert.match((await client.call('c64jasm_manageDebugger', { action: 'status' }, 1000)).content[0].text, /No active/);
    }
    assert.equal(fs.existsSync(path.join(project, 'vice.pid')), false);
    await client.close();
});

test('multicolor sprite PNGs match the VIC color registers including black', fixtureTests, async t => {
    const { project, vice } = createProject(t);
    const client = await connect(t, ['--project', project, '--vice-path', vice]);
    assert.notEqual((await client.call('c64jasm_manageDebugger', { action: 'start' })).isError, true);
    // Four pixel pairs: shared color 1, sprite color, shared color 2, background.
    for (const [address, values] of [[0, [0x6c]], [0xd015, [1]], [0xd01c, [1]], [0xd025, [0, 5, 2]]]) {
        assert.notEqual((await client.call('c64jasm_setRuntimeC64Memory', { address, values })).isError, true);
    }
    const result = await client.call('c64jasm_getRuntimeC64Memory', { spriteImages: true });
    const png = Buffer.from(result.content.find(part => part.type === 'image').data, 'base64');
    const pixels = require('node:zlib').inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
    const pixel = x => [...pixels.subarray(1 + x * 4, 1 + (x + 1) * 4)];
    assert.deepEqual(pixel(0), [0, 0, 0, 255]);
    assert.deepEqual(pixel(2), [0x88, 0, 0, 255]);
    assert.deepEqual(pixel(4), [0, 0xcc, 0x55, 255]);
    await client.close();
});

test('cancelled queued writes never reach VICE', fixtureTests, async t => {
    const { project, vice } = createProject(t, { stepDelayMs: 1000 });
    const client = await connect(t, ['--project', project, '--vice-path', vice]);
    const started = await client.call('c64jasm_manageDebugger', { action: 'start' });
    assert.notEqual(started.isError, true, JSON.stringify(started));
    const step = client.call('c64jasm_manageDebugger', { action: 'stepOut' });
    await waitForFile(path.join(project, 'step.started'));
    const write = client.call('c64jasm_setRuntimeC64Memory', { address: '$D020', values: [9] });
    const cancelled = assert.rejects(write, /cancelled/);
    client.cancel(write);
    await cancelled;
    assert.notEqual((await step).isError, true);
    const state = json(await client.call('c64jasm_getRuntimeC64Memory', { memory: [{ start: '$D020', end: '$D020' }] }));
    assert.deepEqual(state.memory[0].data, [0]);
    await client.close();
});

test('cancelling an active step pauses VICE before the next call', fixtureTests, async t => {
    const { project, vice } = createProject(t, { stepDelayMs: 30000 });
    const client = await connect(t, ['--project', project, '--vice-path', vice]);
    assert.notEqual((await client.call('c64jasm_manageDebugger', { action: 'start' })).isError, true);
    const step = client.call('c64jasm_manageDebugger', { action: 'stepOut' });
    await waitForFile(path.join(project, 'step.started'));
    const cancelled = assert.rejects(step, /cancelled/);
    client.cancel(step);
    await cancelled;
    const status = await client.call('c64jasm_manageDebugger', { action: 'status' });
    assert.match(status.content[0].text, /paused/);
    assert.equal(fs.existsSync(path.join(project, 'step.done')), false);
    await client.close();
});

test('cancelling a launch cleans up its processes and allows another launch', fixtureTests, async t => {
    const { project, vice } = createProject(t, { startupDelayMs: 30000 });
    const client = await connect(t, ['--project', project, '--vice-path', vice]);
    const start = client.call('c64jasm_manageDebugger', { action: 'start' });
    await waitForFile(path.join(project, 'vice.pid'));
    const pid = Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8'));
    const compilerPid = Number(client.stderr().match(/c64jasm server started with pid=(\d+)/)?.[1]);
    assert.ok(compilerPid);
    const cancelled = assert.rejects(start, /cancelled/);
    client.cancel(start);
    await cancelled;
    const status = await client.call('c64jasm_manageDebugger', { action: 'status' });
    assert.match(status.content[0].text, /No active/);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    assert.throws(() => process.kill(compilerPid, 0), /ESRCH/);
    fs.writeFileSync(path.join(project, 'vice-fixture.json'), '{}');
    assert.notEqual((await client.call('c64jasm_manageDebugger', { action: 'start' })).isError, true);
    await client.close();
});

for (const signal of [undefined, 'SIGTERM']) {
    test(`${signal ?? 'stdin EOF'} during launch stops VICE and exits without a forced kill`, fixtureTests, async t => {
        const { project, vice } = createProject(t, { startupDelayMs: 30000 });
        const client = await connect(t, ['--project', project, '--vice-path', vice]);
        const start = client.call('c64jasm_manageDebugger', { action: 'start' });
        start.catch(() => {}); // The transport closes while this request is pending.
        await waitForFile(path.join(project, 'vice.pid'));
        const pid = Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8'));
        const compilerPid = Number(client.stderr().match(/c64jasm server started with pid=(\d+)/)?.[1]);
        assert.ok(compilerPid);
        await client.close(signal);
        assert.throws(() => process.kill(pid, 0), /ESRCH/);
        assert.throws(() => process.kill(compilerPid, 0), /ESRCH/);
    });
}

test('standalone stdio discovery, validation, breakpoint state and errors', async t => {
    const client = await connect(t);
    const { tools } = await client.request('tools/list', {});
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
        'c64jasm_manageDebugger', 'c64jasm_manageBreakpoint', 'c64jasm_getRuntimeC64Memory',
        'c64jasm_resolveMapping', 'c64jasm_setRuntimeC64Memory', 'c64jasm_disassemble'
    ].sort());
    const status = await client.call('c64jasm_manageDebugger', { action: 'status' });
    assert.match(status.content[0].text, /No active/);
    const wrongBackend = await client.call('c64jasm_manageDebugger', { action: 'status', sessionId: 'vscode-session' });
    assert.equal(wrongBackend.isError, true);
    assert.match(json(wrongBackend).error, /not supported by the standalone/);
    const manifest = require('../../package.json');
    assert.equal(manifest.contributes.languageModelTools, undefined, 'Native tools must be removed, not duplicated');
    assert.equal(manifest.contributes.mcpServerDefinitionProviders[0].id, 'c64jasm');
    for (const name of ['c64jasm_getRuntimeC64Memory', 'c64jasm_resolveMapping', 'c64jasm_setRuntimeC64Memory', 'c64jasm_disassemble']) {
        const result = await client.call(name, {});
        assert.equal(result.isError, true);
        assert.match(json(result).error, /No active/);
    }
    const invalid = await client.call('c64jasm_manageDebugger', { action: 'invalid' });
    assert.equal(invalid.isError, true);
    const missingLine = await client.call('c64jasm_manageBreakpoint', { action: 'set', filePath: '/tmp/main.asm' });
    assert.equal(missingLine.isError, true);
    await client.call('c64jasm_manageBreakpoint', { action: 'set', filePath: '/tmp/main.asm', line: 4, condition: 'A == $10' });
    const list = json(await client.call('c64jasm_manageBreakpoint', { action: 'list' }));
    assert.equal(list.count, 1);
    assert.equal(list.breakpoints[0].condition, 'A == $10');
    await client.call('c64jasm_manageBreakpoint', { action: 'removeAll' });
    assert.equal(json(await client.call('c64jasm_manageBreakpoint', { action: 'list' })).count, 0);
});

test('copied bundles run without the checkout or node_modules', async t => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-relocated-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    fs.cpSync(dist, temp, { recursive: true });
    const client = await connect(t, [], path.join(temp, 'index.cjs'));
    assert.equal((await client.request('tools/list', {})).tools.length, 6);
    const version = spawnSync(process.execPath, [path.join(temp, 'cli.js'), '--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), compilerVersion);
    await client.close();
});

test('current MCP SDK client can discover and call the server', async t => {
    const { Client } = require('@modelcontextprotocol/client');
    const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(dist, 'index.cjs')], stderr: 'pipe' });
    transport.stderr.on('data', () => {});
    const client = new Client({ name: 'sdk-client-test', version: '1' });
    t.after(() => client.close());
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
    const result = await client.callTool({ name: 'c64jasm_manageDebugger', arguments: { action: 'status' } });
    assert.match(result.content[0].text, /No active/);
});

test('SIGTERM shuts the server down gracefully', async t => {
    const client = await connect(t);
    await client.close('SIGTERM');
});

test('installed npm package includes the forked compiler and supports the complete debugging flow', {
    timeout: 120000,
    skip: process.platform === 'win32' && 'The fixture executable uses a POSIX shell launcher.'
}, async t => {
    const bundle = installPackage(t);
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-project-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.writeFileSync(path.join(project, 'main.asm'), '* = $0801\n!byte $0c, $08, 0, 0, $9e, $32, $30, $36, $31, 0, 0, 0\nentry:\n    lda #1\n    sta $d020\nloop:\n    jmp loop\n');
    fs.writeFileSync(path.join(project, 'c64jasm.json'), '{ "source": "main.asm" }');
    fs.mkdirSync(path.join(project, '.vscode'));
    fs.writeFileSync(path.join(project, '.vscode/launch.json'), '{ // JSONC launch configuration\n"configurations": [{"name":"Test", "type":"c64jasm-debug", "program":"${workspaceFolder}/out/main.prg",}],}');
    const vice = path.join(project, 'vice');
    const fixture = path.join(__dirname, 'fixtures/vice.cjs');
    fs.writeFileSync(vice, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${fixture.replace(/'/g, "'\\''")}' "$@"\n`, { mode: 0o755 });
    const client = await connect(t, ['--project', project, '--vice-path', vice], bundle);
    const call = async (name, input) => {
        const result = await client.call(name, input);
        assert.notEqual(result.isError, true, `${JSON.stringify(result)}\n${client.stderr().slice(-6000)}`);
        return result;
    };
    await call('c64jasm_manageBreakpoint', { action: 'set', filePath: 'main.asm', line: 4 });
    await call('c64jasm_manageDebugger', { action: 'start', configName: 'Test' });
    const firstPid = Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8'));
    const mapping = json(await call('c64jasm_resolveMapping', { symbol: 'entry' }));
    assert.equal(mapping.address, '0x080D');
    assert.equal(mapping.sourceLocation.line, 4);
    assert.equal(json(await call('c64jasm_manageBreakpoint', { action: 'list' })).breakpoints[0].verified, true);
    await call('c64jasm_setRuntimeC64Memory', { address: '$D020', values: [7], registers: { A: 42 } });
    const invalidWrite = await client.call('c64jasm_setRuntimeC64Memory', { address: '$D020', registers: { A: 99 } });
    assert.equal(invalidWrite.isError, true, 'Invalid combined writes must fail before modifying registers');
    const overflow = await client.call('c64jasm_setRuntimeC64Memory', { address: '$FFFF', values: [1, 2] });
    assert.equal(overflow.isError, true);
    const state = json(await call('c64jasm_getRuntimeC64Memory', { cpu: true, memory: [{ start: '$D020', end: '$D020' }] }));
    assert.deepEqual(state.memory[0].data, [7]);
    assert.equal(state.cpu.A, '0x2A');
    for (const source of ['build', 'live']) {
        const disasm = json(await call('c64jasm_disassemble', { symbol: 'entry', instructionCount: 2, source }));
        assert.equal(disasm.instructionCount, 2);
        assert.match(disasm.instructions[0].instruction, /lda/i);
    }
    const images = await call('c64jasm_getRuntimeC64Memory', { screenshot: true, spriteImages: true });
    assert.equal(images.content.filter(part => part.type === 'image').length, 9);
    assert.equal(json(images).screenshot.width, 2);
    for (const image of images.content.filter(part => part.type === 'image')) {
        assert.equal(Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    // Check that expansion fills the entire sprite, including the last pixel.
    for (const [address, values] of [[0, Array(63).fill(255)], [0xd015, [1]], [0xd017, [1]], [0xd01d, [1]], [0xd027, [2]]]) {
        await call('c64jasm_setRuntimeC64Memory', { address, values });
    }
    const sprites = await call('c64jasm_getRuntimeC64Memory', { spriteImages: true });
    const png = Buffer.from(sprites.content.find(part => part.type === 'image').data, 'base64');
    assert.equal(png.readUInt32BE(16), 48);
    assert.equal(png.readUInt32BE(20), 42);
    const pixels = require('node:zlib').inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
    assert.deepEqual([...pixels.subarray(-4)], [0x88, 0, 0, 255]);
    await call('c64jasm_manageDebugger', { action: 'stepInto' });
    await call('c64jasm_manageDebugger', { action: 'continue' });
    await call('c64jasm_getRuntimeC64Memory', { cpu: true });
    assert.match((await call('c64jasm_manageDebugger', { action: 'status' })).content[0].text, /paused/, client.stderr().slice(-6000));
    await call('c64jasm_manageDebugger', { action: 'start' });
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
    assert.equal(json(await call('c64jasm_manageBreakpoint', { action: 'list' })).breakpoints[0].verified, true);
    const secondPid = Number(fs.readFileSync(path.join(project, 'vice.pid'), 'utf8'));
    await client.close();
    assert.throws(() => process.kill(secondPid, 0), /ESRCH/, 'stdin EOF must stop VICE');
});
