import * as vscode from 'vscode'
import * as path from 'path';
import { Response } from 'vscode-debugadapter';
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

export function toLines(data: any): string[] {
    if (!data)
        return [];
    return data.toString().split('\n').filter((m: string) => m);
}

export async function wrapOp<T>(name: string, response: DebugProtocol.Response, fn: () => Promise<T | undefined>): Promise<T | undefined> {
    let result: T | undefined = undefined;
    try {
        console.log(`start of '${name}`);
        result = await fn();
    } catch (error: any) {
        /*no await*/vscode.window.showErrorMessage(error);
        prepareErrorResponse(response, error, { _exception: error?.stack }, false);
        response.success = false;
        console.error((error as Error)?.stack?.toString());
    }
    console.log(`end of '${name}`);
    return result;
}

export function wrapOpSync<T>(name: string, response: Response, fn: () => T | undefined): T | undefined {
    let result: T | undefined = undefined;
    try {
        console.log(`start of '${name}`);
        result = fn();
    } catch (error: any) {
        /*no await*/vscode.window.showErrorMessage(error);
        prepareErrorResponse(response, error, { _exception: error?.stack }, false);
        response.success = false;
        console.error((error as Error)?.stack?.toString());
    }
    console.log(`end of '${name}`);
    return result;
}

function prepareErrorResponse(response: DebugProtocol.Response, message: string, args: any, showUser: boolean) {
    let msg: DebugProtocol.Message = {
        id: 0,
        format: message
    };
    msg.variables = args;
    msg.showUser = showUser;

    response.success = false;
    response.message = message;
    if (!response.body) {
        response.body = {};
    }
    response.body.error = msg;
}

export function hashString(name: string): number {
    return name.split("").reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
}

export function toBase(value: number, base: number, fixedLen = 2): string {
    return (Array(fixedLen).join("0") + (value >>> 0).toString(base)).slice(-fixedLen).toUpperCase();
}