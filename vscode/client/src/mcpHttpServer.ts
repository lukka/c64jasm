import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse, STATUS_CODES } from 'node:http';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createMcpServer, McpToolBackend } from './mcpServer';

const BODY_LIMIT = 1024 * 1024;
const SESSION_LIMIT = 16;
const REQUEST_LIMIT = 64;
const SESSION_REQUEST_LIMIT = 8;
const SESSION_IDLE_MS = 5 * 60 * 1000;

interface Session {
    server: ReturnType<typeof createMcpServer>;
    transport: WebStandardStreamableHTTPServerTransport;
    requests: Set<RequestState>;
    timer?: ReturnType<typeof setTimeout>;
    closing?: Promise<void>;
    closed: boolean;
}

interface RequestState {
    abort: AbortController;
    session?: Session;
}

export async function startMcpHttpServer(backend: McpToolBackend, options: {
    version: string;
    token?: string;
    onError?: (error: Error) => void;
}): Promise<{ url: string; token: string; close(): Promise<void> }> {
    const token = options.token ?? randomBytes(32).toString('base64url');
    if (!/^[A-Za-z0-9._~+\/-]+=*$/.test(token) || token.length > 512) {
        throw new Error('Invalid MCP HTTP bearer token.');
    }
    const tokenHash = createHash('sha256').update(token).digest();
    const sessions = new Set<Session>();
    const sessionsById = new Map<string, Session>();
    const requests = new Set<RequestState>();
    const sockets = new Set<Socket>();
    let authority = '';
    let url = '';
    let closing = false;
    let closePromise: Promise<void> | undefined;

    function report(message: string): void {
        // SDK errors can contain request bodies, headers, and backend exceptions.
        try { options.onError?.(new Error(message)); } catch { /* Logging must not break the transport. */ }
    }

    const guardedBackend: McpToolBackend = {
        async invoke(name, input, signal) {
            try {
                return await backend.invoke(name, input, signal);
            } catch {
                if (!signal?.aborted) report('MCP HTTP tool invocation failed.');
                return { content: [{ type: 'text', text: 'MCP tool invocation failed.' }], isError: true };
            }
        }
    };

    function forgetSession(session: Session): void {
        session.closed = true;
        clearTimeout(session.timer);
        sessions.delete(session);
        if (session.transport.sessionId) sessionsById.delete(session.transport.sessionId);
    }

    function closeSession(session: Session): Promise<void> {
        if (!session.closing) {
            session.closing = session.server.close()
                .catch(() => report('MCP HTTP session cleanup failed.'))
                .finally(() => forgetSession(session));
        }
        return session.closing;
    }

    function touchSession(session: Session): void {
        clearTimeout(session.timer);
        if (session.closed || closing) return;
        session.timer = setTimeout(() => {
            if (session.requests.size) touchSession(session);
            else void closeSession(session);
        }, SESSION_IDLE_MS);
        session.timer.unref();
    }

    async function newSession(): Promise<Session> {
        const mcp = createMcpServer(guardedBackend, { version: options.version, mode: 'vscode' });
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomBytes(24).toString('base64url'),
            maxRequestBodySize: BODY_LIMIT,
            onsessioninitialized: id => {
                if (closing || session.closed) throw new Error('MCP HTTP endpoint closed.');
                sessionsById.set(id, session);
            }
        });
        const session: Session = { server: mcp, transport, requests: new Set(), closed: false };
        sessions.add(session);
        transport.onclose = () => forgetSession(session);
        mcp.server.onerror = () => report('MCP HTTP protocol error.');
        try {
            await mcp.connect(transport);
            touchSession(session);
            return session;
        } catch {
            await closeSession(session);
            throw new Error('MCP HTTP session initialization failed.');
        }
    }

    function headerCount(req: IncomingMessage, name: string): number {
        let count = 0;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            if (req.rawHeaders[i].toLowerCase() === name) count++;
        }
        return count;
    }

    function rejection(req: IncomingMessage): number | undefined {
        const match = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(req.headers.authorization ?? '');
        const suppliedHash = createHash('sha256').update(match?.[1] ?? '').digest();
        const matches = timingSafeEqual(suppliedHash, tokenHash);
        if (!matches || !match || headerCount(req, 'authorization') !== 1) return 401;
        if (req.headers.host !== authority || headerCount(req, 'host') !== 1) return 403;
        if (headerCount(req, 'origin')) return 403;
        if (closing) return 503;
        if (req.url !== '/mcp') return 404;
        return undefined;
    }

    function fail(res: ServerResponse, status: number): void {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(status, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            Connection: 'close',
            ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
            ...(status === 405 ? { Allow: 'GET, POST, DELETE' } : {})
        });
        res.end(`${STATUS_CODES[status] ?? 'MCP HTTP request failed'}\n`);
    }

    async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const rejected = rejection(req);
        if (rejected) { fail(res, rejected); return; }
        if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) { fail(res, 405); return; }
        if (Number(req.headers['content-length']) > BODY_LIMIT) { fail(res, 413); return; }
        if (req.headers.expect && req.headers.expect.toLowerCase() !== '100-continue') { fail(res, 417); return; }
        if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') { fail(res, 415); return; }
        if (req.method !== 'POST' && (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'])) {
            fail(res, 400); return;
        }
        if (requests.size >= REQUEST_LIMIT) { fail(res, 429); return; }
        const id = req.headers['mcp-session-id'];
        if ((id !== undefined && (typeof id !== 'string' || !id || id.length > 128)) || headerCount(req, 'mcp-session-id') > 1) {
            fail(res, 400); return;
        }
        let session = typeof id === 'string' ? sessionsById.get(id) : undefined;
        if (id !== undefined && !session) { fail(res, 404); return; }
        if (!session && req.method !== 'POST') { fail(res, 400); return; }
        if (!session && sessions.size >= SESSION_LIMIT) { fail(res, 503); return; }
        if (session && session.requests.size >= SESSION_REQUEST_LIMIT) { fail(res, 429); return; }

        const state: RequestState = { abort: new AbortController(), session };
        requests.add(state);
        const release = () => {
            requests.delete(state);
            state.session?.requests.delete(state);
            if (state.session) touchSession(state.session);
            req.off('aborted', disconnect);
            res.off('close', responseClosed);
        };
        const disconnect = () => {
            state.abort.abort();
            // No resumability is advertised: abandon only this client's protocol state.
            if (state.session) void closeSession(state.session);
        };
        const responseClosed = () => {
            if (!res.writableFinished) disconnect();
            release();
        };
        req.once('aborted', disconnect);
        req.on('error', () => { state.abort.abort(); });
        res.once('finish', release);
        res.once('close', responseClosed);
        res.on('error', disconnect);
        try {
            if (!session) session = await newSession();
            state.session = session;
            session.requests.add(state);
            touchSession(session);
            if (closing || session.closed || state.abort.signal.aborted) { fail(res, 503); return; }
            if (req.headers.expect) res.writeContinue();
            const headers = new Headers();
            for (const name of ['accept', 'content-type', 'content-length', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']) {
                const value = req.headers[name];
                if (typeof value === 'string') headers.set(name, value);
            }
            // Credentials never enter the SDK's request context or diagnostics.
            const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers, signal: state.abort.signal };
            if (req.method === 'POST') {
                init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
                init.duplex = 'half';
            }
            const response = await session.transport.handleRequest(new Request(url, init));
            if (response.status >= 400) {
                await response.body?.cancel();
                fail(res, response.status);
                return;
            }
            if (res.destroyed || res.writableEnded) { await response.body?.cancel(); return; }
            res.statusCode = response.status;
            response.headers.forEach((value, name) => res.setHeader(name, value));
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.flushHeaders();
            if (response.body) {
                await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res, { signal: state.abort.signal });
            } else res.end();
        } catch {
            if (!closing && !state.abort.signal.aborted) report('MCP HTTP request failed.');
            fail(res, 500);
        } finally {
            if (session && !session.transport.sessionId) await closeSession(session);
            if (res.destroyed || res.writableFinished) release();
        }
    }

    const listener = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => { void dispatch(req, res); });
    listener.maxConnections = 128;
    listener.headersTimeout = 10000;
    listener.requestTimeout = 30000;
    listener.keepAliveTimeout = 1000;
    listener.on('checkContinue', (req, res) => { void dispatch(req, res); });
    listener.on('checkExpectation', (req, res) => { void dispatch(req, res); });
    listener.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    const rejectUpgrade = (req: IncomingMessage, socket: Socket) => {
        const status = rejection(req) ?? 405;
        socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n${status === 401 ? 'WWW-Authenticate: Bearer\r\n' : ''}\r\n`);
    };
    listener.on('upgrade', rejectUpgrade);
    listener.on('connect', rejectUpgrade);
    listener.on('clientError', (_error, socket) => {
        if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        else socket.destroy();
    });
    listener.on('error', () => report('MCP HTTP listener failed.'));
    try {
        await new Promise<void>((resolve, reject) => {
            const failed = () => reject(new Error('Unable to start MCP HTTP endpoint.'));
            listener.once('error', failed);
            listener.listen(0, '127.0.0.1', () => { listener.off('error', failed); resolve(); });
        });
    } catch {
        listener.close();
        throw new Error('Unable to start MCP HTTP endpoint.');
    }
    const address = listener.address();
    if (!address || typeof address === 'string') {
        listener.close();
        throw new Error('Unable to start MCP HTTP endpoint.');
    }
    authority = `127.0.0.1:${address.port}`;
    url = `http://${authority}/mcp`;

    return {
        url,
        token,
        close() {
            if (!closePromise) {
                closing = true;
                closePromise = (async () => {
                    const stopped = new Promise<void>(resolve => listener.close(() => resolve()));
                    for (const request of requests) request.abort.abort();
                    await Promise.all([...sessions].map(closeSession));
                    for (const socket of sockets) socket.destroy();
                    await stopped;
                })();
            }
            return closePromise;
        }
    };
}
