import * as path from 'path';
import { DebugProtocol } from 'vscode-debugprotocol';

export function toDotC64jasmDir(p: string, e: string): string | undefined {
    let relocatedP = _toDotC64jasmDir(p);
    if (relocatedP) {
        return replaceExtension(relocatedP, e);
    }
    return undefined;
}

function _toDotC64jasmDir(p: string): string {
    const dotc64jasm = '.c64jasm';
    const parsed = path.parse(p);
    parsed.dir = path.join(parsed.dir, dotc64jasm);
    return path.format(parsed);
}

function replaceExtension(p: string, ext: string): string {
    const parsed = path.parse(p);
    parsed.base = '';
    parsed.ext = ext;
    return path.format(parsed);
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a TCP port is open and accepting connections
 */
export function isPortOpen(host: string, port: number, timeout: number = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const net = require('net');
        const socket = new net.Socket();

        let isResolved = false;

        const cleanup = () => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
            }
        };

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            cleanup();
            resolve(true);
        });

        socket.on('timeout', () => {
            cleanup();
            resolve(false);
        });

        socket.on('error', () => {
            cleanup();
            resolve(false);
        });

        socket.connect(port, host);
    });
}

/**
 * Wait for a TCP port to become available, polling at regular intervals
 */
export async function waitForPort(host: string, port: number, timeoutMs: number = 30000, pollIntervalMs: number = 500): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const isOpen = await isPortOpen(host, port, 1000);
        if (isOpen) {
            return;
        }
        await delay(pollIntervalMs);
    }

    throw new Error(`Timeout waiting for port ${port} to become available after ${timeoutMs}ms`);
}

export function toLines(data: any): string[] {
    if (!data)
        return [];
    return data.toString().split('\n').filter((m: string) => m);
}

export async function wrapOp<T>(name: string, response: DebugProtocol.Response,
    fn: () => Promise<T | undefined>,
    responder: any /* the responder should be an interface */): Promise<T | undefined> {
    let result: T | undefined = undefined;
    try {
        console.log(`start of '${name}`);
        result = await fn();
    } catch (error: any) {
        response.success = false;
        response.message = error.toString();
        console.error((error as Error)?.stack?.toString());
    } finally {
        if (response.success)
            responder.sendResponse(response);
        else
            responder.sendErrorResponse(response, 0, response.message ?? "error");

        console.log(`end of '${name}`);
        return result;
    }
}

export function wrapOpSync<T>(name: string, response: DebugProtocol.Response, fn: () => T | undefined, responder: any): T | undefined {
    let result: T | undefined = undefined;
    try {
        console.log(`start of '${name}`);
        result = fn();
    } catch (error: any) {
        response.success = false;
        response.message = error.toString();
        console.error((error as Error)?.stack?.toString());
    } finally {
        if (response.success)
            responder.sendResponse(response);
        else
            responder.sendErrorResponse(response, 0, response.message ?? "error");
    }
    console.log(`end of '${name}`);
    return result;
}

export function hashString(name: string): number {
    return name.split("").reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
}

export function toBase(value: number, base: number, fixedLen = 2): string {
    return (value >>> 0).toString(base).padStart(fixedLen, "0").toUpperCase();
}