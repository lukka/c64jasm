const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');

const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'client/src/mcpHttpServer.ts');
const bundle = buildSync({
    entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20',
    nodePaths: [path.join(root, 'node_modules'), path.join(root, 'mcp/node_modules')], logLevel: 'silent'
}).outputFiles[0].text;
const compiled = new Module(source, module);
compiled.filename = source;
compiled.paths = Module._nodeModulePaths(path.dirname(source));
compiled._compile(bundle, source);
const { startMcpHttpServer } = compiled.exports;

const STATUS_TOOL = 'c64jasm_manageDebugger';
const MEMORY_TOOL = 'c64jasm_getRuntimeC64Memory';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const json = result => JSON.parse(result.content.find(part => part.type === 'text').text);

function fakeBackend(handler = async (_name, input) => text({ action: input.action, sessionId: 'editor-session' })) {
    const calls = [], lifecycle = [];
    return {
        calls, lifecycle,
        async invoke(name, input, signal) {
            calls.push({ name, input, signal });
            return handler(name, input, signal);
        },
        dispose() { lifecycle.push('dispose'); },
        stop() { lifecycle.push('stop'); },
        close() { lifecycle.push('close'); }
    };
}

async function endpoint(t, backend = fakeBackend(), options = {}) {
    const server = await startMcpHttpServer(backend, { version: 'http-test-version', ...options });
    t.after(() => server.close());
    return server;
}

async function connect(t, server, token = server.token) {
    const client = new Client({ name: 'c64jasm-http-test', version: '1' });
    client.onerror = () => {};
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        reconnectionOptions: { initialReconnectionDelay: 10, maxReconnectionDelay: 10, reconnectionDelayGrowFactor: 1, maxRetries: 0 }
    });
    t.after(async () => {
        await transport.terminateSession().catch(() => {});
        await client.close();
    });
    await client.connect(transport, { timeout: 3000 });
    return { client, transport };
}

function request(server, { method = 'POST', headers = {}, body, token = server.token, pathname, chunked = false } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(server.url);
        if (pathname !== undefined) url.pathname = pathname;
        let responseStarted = false;
        const req = http.request(url, {
            method, agent: false,
            headers: {
                Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
                ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...headers
            }
        }, res => {
            responseStarted = true;
            let data = '';
            res.setEncoding('utf8');
            res.on('data', part => { data += part; });
            res.on('error', reject);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.setTimeout(3000, () => req.destroy(new Error('HTTP test request timed out.')));
        // Early 413 responses may close the write side while their response is still readable.
        req.on('error', error => { if (!responseStarted) reject(error); });
        if (chunked) {
            for (const chunk of body) req.write(chunk);
            req.end();
        } else req.end(body);
    });
}

async function waitFor(predicate) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
        if (Date.now() >= deadline) assert.fail('Timed out waiting for HTTP test state.');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

function waitForAbort(signal) {
    assert.ok(signal instanceof AbortSignal, 'The SDK cancellation signal must reach the shared backend.');
    return new Promise(resolve => {
        if (signal.aborted) resolve(text({ cancelled: true }));
        else signal.addEventListener('abort', () => resolve(text({ cancelled: true })), { once: true });
    });
}

const initialize = id => JSON.stringify({
    jsonrpc: '2.0', id, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-limit-test', version: '1' } }
});

const focused = { timeout: 15000 };

test('HTTP SDK initialize, list, and calls preserve text, PNG images, and tool errors', focused, async t => {
    const backend = fakeBackend(async (name, input) => {
        if (name === MEMORY_TOOL) return { content: [text({ cpu: { pc: 4096 } }).content[0], { type: 'image', data: PNG, mimeType: 'image/png' }] };
        if (input.sessionId === 'error') return { ...text({ error: 'No C64 session selected.' }), isError: true };
        return text({ action: input.action, sessionId: 'editor-session' });
    });
    const server = await endpoint(t, backend);
    const { client, transport } = await connect(t, server);
    assert.equal(new URL(server.url).hostname, '127.0.0.1');
    assert.equal(new URL(server.url).pathname, '/mcp');
    assert.ok(Number(new URL(server.url).port) > 0);
    assert.equal(client.getServerVersion().name, 'c64jasm');
    assert.equal(client.getServerVersion().version, 'http-test-version');
    assert.match(client.getInstructions(), /VS Code/);
    assert.ok(transport.sessionId);
    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === STATUS_TOOL));
    assert.ok(tools.some(tool => tool.name === MEMORY_TOOL));
    assert.deepEqual(json(await client.callTool({ name: STATUS_TOOL, arguments: { action: 'status' } })), { action: 'status', sessionId: 'editor-session' });
    const image = await client.callTool({ name: MEMORY_TOOL, arguments: { screenshot: true } });
    assert.deepEqual(image.content, [text({ cpu: { pc: 4096 } }).content[0], { type: 'image', data: PNG, mimeType: 'image/png' }]);
    const error = await client.callTool({ name: STATUS_TOOL, arguments: { action: 'status', sessionId: 'error' } });
    assert.equal(error.isError, true);
    assert.deepEqual(json(error), { error: 'No C64 session selected.' });
    assert.equal(backend.calls.length, 3);
    assert.deepEqual(backend.calls[1].input, { screenshot: true });
    assert.ok(backend.calls.every(call => call.signal instanceof AbortSignal));
    assert.deepEqual(backend.lifecycle, []);
});

test('each start generates a fresh strong token without putting it in the URL', focused, async t => {
    const first = await endpoint(t);
    const second = await endpoint(t);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first.token, second.token);
    assert.ok(!first.url.includes(first.token));
    assert.equal((await request(first, { token: second.token, body: initialize(1) })).status, 401);
    const supplied = await endpoint(t, fakeBackend(), { token: 'explicit-test-token' });
    assert.equal(supplied.token, 'explicit-test-token');
    await connect(t, supplied);
    await assert.rejects(startMcpHttpServer(fakeBackend(), { version: '1', token: '' }), /Invalid MCP HTTP bearer token/);
});

test('two SDK clients share backend state but have independent protocol sessions and disconnect cancellation', focused, async t => {
    let state = 0;
    const backend = fakeBackend(async (_name, input, signal) => {
        if (input.sessionId === 'hold') return waitForAbort(signal);
        if (input.action === 'pause') state++;
        return text({ state });
    });
    const server = await endpoint(t, backend);
    const first = await connect(t, server);
    const second = await connect(t, server);
    assert.notEqual(first.transport.sessionId, second.transport.sessionId);
    await first.client.callTool({ name: STATUS_TOOL, arguments: { action: 'pause' } });
    assert.deepEqual(json(await second.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status' } })), { state: 1 });
    const pending = first.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status', sessionId: 'hold' } }).then(() => 'completed', () => 'cancelled');
    await waitFor(() => backend.calls.some(call => call.input.sessionId === 'hold'));
    const held = backend.calls.find(call => call.input.sessionId === 'hold');
    await first.client.close();
    assert.equal(await pending, 'cancelled');
    await waitFor(() => held.signal.aborted);
    assert.deepEqual(json(await second.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status' } })), { state: 1 });
    assert.deepEqual(backend.lifecycle, []);
    assert.equal((await request(server, { method: 'GET', headers: { 'Mcp-Session-Id': first.transport.sessionId } })).status, 404);
});

test('SDK session termination cancels only that session and leaves the backend and other client live', focused, async t => {
    const backend = fakeBackend(async (_name, input, signal) => input.sessionId === 'hold' ? waitForAbort(signal) : text({ live: true }));
    const server = await endpoint(t, backend);
    const first = await connect(t, server);
    const second = await connect(t, server);
    const id = first.transport.sessionId;
    const pending = first.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status', sessionId: 'hold' } }).catch(() => undefined);
    await waitFor(() => backend.calls.length === 1);
    await first.transport.terminateSession();
    await first.client.close();
    await pending;
    assert.ok(backend.calls[0].signal.aborted);
    assert.deepEqual(json(await second.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status' } })), { live: true });
    assert.equal((await request(server, { method: 'DELETE', headers: { 'Mcp-Session-Id': id } })).status, 404);
    assert.deepEqual(backend.lifecycle, []);
});

test('all HTTP methods authenticate before routing, payload checks, or parsing', focused, async t => {
    const backend = fakeBackend();
    const server = await endpoint(t, backend);
    for (const method of ['POST', 'GET', 'DELETE', 'PUT', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']) {
        const result = await request(server, { method, token: null, body: method === 'POST' ? '{malformed' : undefined });
        assert.equal(result.status, 401, method);
        assert.equal(result.headers['www-authenticate'], 'Bearer');
        assert.ok(!result.body.includes(server.token));
    }
    assert.equal((await request(server, { token: null, headers: { 'Content-Length': String(1024 * 1024 + 1) } })).status, 401);
    assert.equal((await request(server, { token: null, headers: { Host: 'untrusted.invalid' }, pathname: '/elsewhere' })).status, 401);
    for (const Authorization of ['Basic not-a-token', `Bearer ${server.token}x`, `Bearer ${server.token.slice(1)}`, [`Bearer ${server.token}`, `Bearer ${server.token}`]]) {
        assert.equal((await request(server, { headers: { Authorization }, body: initialize(1) })).status, 401);
    }
    await assert.rejects(connect(t, server, 'wrong-test-token'));
    assert.equal(backend.calls.length, 0);
    await connect(t, server);
});

test('the exact bound Host is required and every browser Origin is rejected', focused, async t => {
    const server = await endpoint(t);
    const url = new URL(server.url);
    for (const Host of ['untrusted.invalid', `localhost:${url.port}`, '127.0.0.1', `127.0.0.1:${Number(url.port) + 1}`, `${url.host}, ${url.host}`]) {
        const result = await request(server, { headers: { Host }, body: initialize(1) });
        assert.equal(result.status, 403, Host);
        assert.ok(!result.body.includes(Host));
    }
    for (const Origin of ['https://untrusted.invalid', url.origin, 'null', '', `https://${server.token}.invalid`]) {
        const result = await request(server, { headers: { Origin }, body: initialize(1) });
        assert.equal(result.status, 403, `Origin: ${Origin}`);
        assert.equal(result.headers['access-control-allow-origin'], undefined);
        assert.ok(!result.body.includes(server.token));
    }
    await connect(t, server);
});

test('authenticated malformed requests, unknown sessions, methods, and paths have sanitized errors', focused, async t => {
    const diagnostics = [];
    const server = await endpoint(t, fakeBackend(), { onError: error => diagnostics.push(error) });
    for (const body of [`{\"secret\":\"${server.token}`, 'null', '{}', '[]', JSON.stringify({ jsonrpc: '2.0', id: {}, method: server.token })]) {
        const result = await request(server, { body });
        assert.equal(result.status, 400);
        assert.ok(!result.body.includes(server.token));
    }
    assert.equal((await request(server, { method: 'PUT' })).status, 405);
    assert.equal((await request(server, { method: 'GET' })).status, 400);
    assert.equal((await request(server, { headers: { 'Mcp-Session-Id': server.token }, body: initialize(1) })).status, 404);
    assert.equal((await request(server, { headers: { 'Content-Type': 'text/plain' }, body: initialize(1) })).status, 415);
    assert.equal((await request(server, { headers: { Accept: 'application/json' }, body: initialize(1) })).status, 406);
    assert.equal((await request(server, { pathname: '/elsewhere', body: initialize(1) })).status, 404);
    const { client, transport } = await connect(t, server);
    const unsupported = await request(server, { method: 'GET', headers: { 'Mcp-Session-Id': transport.sessionId, 'Mcp-Protocol-Version': server.token } });
    assert.equal(unsupported.status, 400);
    assert.ok(!unsupported.body.includes(server.token));
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(error => error instanceof Error && !`${error.message}\n${error.stack}`.includes(server.token)));
    await client.listTools();
});

test('backend exceptions and diagnostic callback failures cannot disclose credentials or crash HTTP', focused, async t => {
    let secret;
    const diagnostics = [];
    const backend = fakeBackend(async () => { throw new Error(`private backend detail ${secret}`); });
    const server = await endpoint(t, backend, { onError: error => { diagnostics.push(error.message); throw new Error('diagnostic callback failed'); } });
    secret = server.token;
    const { client } = await connect(t, server);
    const result = await client.callTool({ name: STATUS_TOOL, arguments: { action: 'status' } });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes('private backend detail'));
    assert.ok(diagnostics.length > 0);
    assert.ok(!diagnostics.join('\n').includes(secret));
    assert.equal((await request(server, { body: `{${secret}` })).status, 400);
    await client.listTools();
});

test('declared and chunked payloads are bounded before JSON parsing', focused, async t => {
    const backend = fakeBackend();
    const server = await endpoint(t, backend);
    const limit = 1024 * 1024;
    assert.equal((await request(server, { headers: { 'Content-Length': String(limit + 1) } })).status, 413);
    assert.equal((await request(server, { body: initialize(1).padEnd(limit, ' ') })).status, 200);
    const chunks = [...Array.from({ length: 16 }, () => Buffer.alloc(limit / 16, 120)), Buffer.from('x')];
    assert.equal((await request(server, { chunked: true, body: chunks })).status, 413);
    assert.equal(backend.calls.length, 0);
    await connect(t, server);
});

test('session allocation is bounded and DELETE releases capacity', focused, async t => {
    const backend = fakeBackend();
    const server = await endpoint(t, backend);
    const ids = [];
    for (let i = 0; i < 16; i++) {
        const result = await request(server, { body: initialize(i) });
        assert.equal(result.status, 200);
        assert.ok(result.headers['mcp-session-id']);
        ids.push(result.headers['mcp-session-id']);
    }
    assert.equal(new Set(ids).size, 16);
    assert.equal((await request(server, { body: initialize(17) })).status, 503);
    assert.equal((await request(server, { method: 'DELETE', headers: { 'Mcp-Session-Id': ids[0] } })).status, 200);
    assert.equal((await request(server, { body: initialize(18) })).status, 200);
    assert.deepEqual(backend.lifecycle, []);
});

test('per-session concurrent requests are bounded without blocking another client', focused, async t => {
    const backend = fakeBackend(async (_name, input, signal) => input.sessionId === 'hold' ? waitForAbort(signal) : text({ live: true }));
    const server = await endpoint(t, backend);
    const first = await connect(t, server);
    const second = await connect(t, server);
    const rejected = [];
    const pending = Array.from({ length: 12 }, () => first.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status', sessionId: 'hold' } })
        .catch(error => { rejected.push(error); }));
    await waitFor(() => rejected.length > 0 && backend.calls.some(call => call.input.sessionId === 'hold'));
    assert.ok(rejected.some(error => /429|Too Many Requests/.test(error.message)));
    assert.ok(backend.calls.filter(call => call.input.sessionId === 'hold').length <= 8);
    assert.deepEqual(json(await second.client.callTool({ name: STATUS_TOOL, arguments: { action: 'status' } })), { live: true });
    await first.client.close();
    await Promise.all(pending);
    assert.deepEqual(backend.lifecycle, []);
});

test('global concurrent requests are bounded even while authenticated bodies are incomplete', focused, async t => {
    const backend = fakeBackend();
    const server = await endpoint(t, backend);
    const ids = [];
    for (let i = 0; i < 8; i++) {
        const result = await request(server, { body: initialize(i) });
        assert.equal(result.status, 200);
        ids.push(result.headers['mcp-session-id']);
    }
    const uploads = [];
    t.after(() => uploads.forEach(upload => upload.destroy()));
    await Promise.all(ids.flatMap(id => Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
        const upload = http.request(server.url, { method: 'POST', agent: false, headers: {
            Authorization: `Bearer ${server.token}`, 'Mcp-Session-Id': id, 'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream', 'Content-Length': '1024'
        } });
        uploads.push(upload);
        upload.on('error', reject);
        upload.on('response', response => response.resume());
        upload.write('{', error => error ? reject(error) : resolve());
    }))));
    assert.equal((await request(server, { method: 'GET' })).status, 429);
    const closed = uploads.map(upload => new Promise(resolve => upload.once('close', resolve)));
    await server.close();
    await Promise.all(closed);
    assert.equal(backend.calls.length, 0);
    assert.deepEqual(backend.lifecycle, []);
});

test('shutdown is idempotent, aborts operations and partial uploads, and never stops the backend', focused, async t => {
    const backend = fakeBackend(async (_name, input, signal) => input.sessionId === 'hold' ? waitForAbort(signal) : text({ live: true }));
    const server = await endpoint(t, backend);
    const { client } = await connect(t, server);
    const pending = client.callTool({ name: STATUS_TOOL, arguments: { action: 'status', sessionId: 'hold' } }).catch(() => undefined);
    await waitFor(() => backend.calls.length === 1);
    const upload = http.request(server.url, { method: 'POST', agent: false, headers: {
        Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': '1024'
    } });
    upload.on('error', () => {});
    upload.on('response', response => response.resume());
    t.after(() => upload.destroy());
    upload.write('{');
    const closedUpload = new Promise(resolve => upload.once('close', resolve));
    await new Promise(resolve => upload.once('socket', socket => socket.connecting ? socket.once('connect', resolve) : resolve()));
    const close = server.close();
    assert.strictEqual(server.close(), close);
    await close;
    await closedUpload;
    assert.ok(backend.calls[0].signal.aborted);
    // Legacy SDK clients settle outstanding promises on client.close(), not SSE EOF.
    await client.close();
    await pending;
    assert.deepEqual(backend.lifecycle, []);
    assert.deepEqual(json(await backend.invoke(STATUS_TOOL, { action: 'status' })), { live: true });
    await assert.rejects(request(server, { body: initialize(1) }), error => error.code === 'ECONNREFUSED');
});
