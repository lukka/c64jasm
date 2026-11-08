import * as path from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { C64Controller, ServerOptions } from './controller';
import { createServer } from './server';
import { version } from '../package.json';

// The shared runtime's diagnostic output must never enter the JSON-RPC channel.
console.log = console.error.bind(console);
console.info = console.error.bind(console);
console.debug = console.error.bind(console);

function parseOptions(args: string[]): ServerOptions | undefined {
    const options: ServerOptions = { projectPath: process.cwd(), vicePath: 'x64sc', useEmbeddedCompiler: true };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--help': case '-h':
                process.stdout.write('Usage: c64jasm-devtools-mcp [--project DIRECTORY] [--vice-path EXECUTABLE] [--system-compiler]\n\nServes the six c64jasm debugger tools over MCP stdio. Requires Node.js 20+ and VICE.\n');
                return undefined;
            case '--version':
                process.stdout.write(`${version}\n`);
                return undefined;
            case '--project': case '--vice-path': {
                const option = args[i];
                const value = args[++i];
                if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
                if (option === '--project') options.projectPath = path.resolve(value);
                else options.vicePath = value;
                break;
            }
            case '--system-compiler': options.useEmbeddedCompiler = false; break;
            default: throw new Error(`Unknown option: ${args[i]}. Use --help for usage.`);
        }
    }
    return options;
}

function main(): void {
    const options = parseOptions(process.argv.slice(2));
    if (!options) return;
    const controller = new C64Controller(options);
    const handle = serveStdio(() => createServer(controller), { onerror: error => console.error(error.message) });
    let closing: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
        if (!closing) {
            closing = controller.dispose().finally(() => handle.close()).catch(error => {
                console.error(error);
                process.exitCode = 1;
            });
        }
        return closing;
    };
    process.stdin.once('end', () => { void shutdown(); });
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
}

try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
