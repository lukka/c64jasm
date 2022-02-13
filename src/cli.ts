#!/usr/bin/env node

import * as process from 'process';
import * as fs from 'fs';
import * as path from 'path';
import { sprintf } from 'sprintf-js';

import * as net from 'net';
import { writeFileSync } from 'fs';
import { assemble } from './asm';
import { disassemble } from './disasm';
import { ArgumentParser } from 'argparse';
import { toHex16 } from './util';
import * as util from './util';

const chokidar = require('chokidar');

let args: any = null;
let latestSuccessfulCompile: any = undefined;
let lastCompilationFailed: boolean = false;

const PORT = 6502;
const HOST = 'localhost';

// TODO maybe better to use HTTP for this?
function startDebugInfoServer() {
    var server = net.createServer(onConnected);

    server.listen(PORT, HOST, function() {
        console.log(`[C64JASM Debugger Server] Listening on ${HOST}:${PORT}`);
        console.log(`[C64JASM Debugger Server] Providing debug info for: ${args.source}`);
    });

    function onConnected(sock: net.Socket) {
        var remoteAddress = sock.remoteAddress + ':' + sock.remotePort;
        console.log('[C64JASM Debugger Server] New debugger connected: %s', remoteAddress);

        sock.on('data', function(data: string) {
            const requestStr = data.toString().trim();
            if (requestStr == 'debug-info') {
                if (lastCompilationFailed) {
                    sock.write(JSON.stringify({
                        error: 'Compilation failed. Check the c64jasm server output for details.'
                    }));
                } else if (latestSuccessfulCompile) {
                    sock.write(JSON.stringify({
                        outputPrg: args.out,
                        symbols: latestSuccessfulCompile.labels,
                        variables: latestSuccessfulCompile.variables,
                        debugInfo: latestSuccessfulCompile.debugInfo.info()
                    }))
                } else {
                    sock.write(JSON.stringify({
                        error: 'No successful compilation yet'
                    }))
                }
                sock.end();
            }
            console.log('[C64JASM Debugger Server] %s Requested: %s', remoteAddress, requestStr);
        });
        sock.on('close',  function () {
            console.log('[C64JASM Debugger Server] Connection from %s closed', remoteAddress);
        });
    }
}

function withWriteFileOrStdout(filename: string, proc: (writeSync: (line: string) => void) => void) {
    if (filename === '-') {
        proc(msg => process.stdout.write(msg));
    } else {
        try {
            const fd = fs.openSync(filename, 'w');
            proc(msg => fs.writeSync(fd, msg));
            fs.closeSync(fd);
        } catch(err) {
            console.error(err);
        }
    }
}

function compile(args: any) {
    const sourcePath = path.resolve(args.source);
    const outPath = path.resolve(args.out);

    if (sourcePath === outPath) {
        console.error(`Error: The output file "${args.out}" is the same as the source file "${args.source}".`);
        return false;
    }

    if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
         console.error(`Error: The output file "${args.out}" is a directory.`);
         return false;
    }

    console.log(`Compiling ${args.source}`)
    const hrstart = process.hrtime();

    const result = assemble(args.source);
    if (!result) {
        console.log('Compilation failed.')
        lastCompilationFailed = true;
        return false;
    }
    const { errors, prg, labels, segments, debugInfo } = result;

    if (errors.length !== 0) {
        errors.forEach(err => {
            console.log(err.formatted);
        })
        console.log('Compilation failed.')
        lastCompilationFailed = true;
        return false;
    }
    lastCompilationFailed = false;
    latestSuccessfulCompile = result;
    writeFileSync(args.out, Uint8Array.from(prg))
    console.log(`Compilation succeeded.  Output written to ${args.out}`)

    if (args.verbose) {
        const NS_PER_SEC = 1e9;
        const diff = process.hrtime(hrstart);
        const deltaNS = diff[0] * NS_PER_SEC + diff[1];
        console.info('Compilation completed %d ms', Math.floor((deltaNS/1000000.0)*100)/100);
    }

    if (args.labelsFile) {
        function printLabels(p: (n: string) => void) {
            labels.forEach(({name, addr, size}) => {
                const msg = sprintf("%s %4d %s\n", toHex16(addr), size, name);
                p(msg);
            })
        }
        withWriteFileOrStdout(args.labelsFile, printLabels);
    }

    if (args.viceMonCommandsFile) {
        function printViceMon(p: (n: string) => void) {
            util.exportViceMoncommands(p, labels, debugInfo!);
        }
        withWriteFileOrStdout(args.viceMonCommandsFile, printViceMon);
    }

    if (args.c64debuggerSymbolsFile) {
        function printC64debuggerSymbols(p: (n: string) => void) {
            util.exportC64debuggerInfo(p, labels, segments, debugInfo!);
        }
        withWriteFileOrStdout(args.c64debuggerSymbolsFile, printC64debuggerSymbols);
    }

    if (args.disasmFile) {
        let fd: number;
        try {
            const { isInstruction } = debugInfo!.info();
            const disasm = disassemble(prg, labels, { isInstruction, showLabels: args.disasmShowLabels, showCycles: args.disasmShowCycles });
            function printLines(p: (n: string) => void) {
                for (const line of disasm) {
                    p(`${line}\n`);
                }
            }
            withWriteFileOrStdout(args.disasmFile, printLines);
        } catch(err) {
            console.error(err);
        }
    }

    return true;
}

const version = require('../../package.json').version

const parser = new ArgumentParser({
    version,
    addHelp: true,
    prog: 'c64jasm',
    description: 'C64 macro assembler'
});

parser.addArgument('--verbose', {
    action: 'storeConst',
    constant:true
});

function parseBool(str: string) {
    if (str === '0' || str === 'false' || str === 'no') {
        return false;
    }
    if (str === '1' || str === 'true' || str === 'yes') {
        return true;
    }
    throw new Error(`invalid boolean argument: ${str}`);
}

parser.addArgument('--out', { required: true, help: 'Output .prg filename' })
parser.addArgument('--watch', {
    action: 'append',
    help: 'Watch directories/files and recompile on changes.  Add multiple --watch args if you want to watch for multiple dirs/files.'
});
// Server for debuggers to connect to for program information
parser.addArgument('--server', {
    action: 'storeConst',
    constant: true,
    dest: 'startServer',
    help: 'Start a debug info server that debuggers can call to ask for latest successful compile results.  Use with --watch'
});
parser.addArgument('--dump-labels', {
    dest: 'labelsFile',
    help: 'Dump program address and size for all labels declared in the source files to <FILE> (use \'-\' for stdout.)',
    metavar: 'FILE'
});
parser.addArgument('--vice-moncommands', {
   dest: 'viceMonCommandsFile',
   help: 'Save labels and breakpoint information into a VICE moncommands file to <FILE> (use \'-\' for stdout.)',
   metavar: 'FILE'
});
parser.addArgument('--c64debugger-symbols', {
   dest: 'c64debuggerSymbolsFile',
   help: 'Save C64debugger .dbg file to <FILE> (use \'-\' for stdout.)',
   metavar: 'FILE'
});
parser.addArgument('--disasm', {
    dest: 'disasmFile',
    help: 'Disassemble the resulting binary to <FILE> (use \'-\' for stdout.)',
    metavar: 'FILE'
});
parser.addArgument('--disasm-show-labels', {
    constant: true,
    defaultValue: true,
    dest: 'disasmShowLabels',
    type: parseBool,
    help: 'Show labels in disassembly.'
});
parser.addArgument('--disasm-show-cycles', {
    constant: true,
    defaultValue: true,
    dest: 'disasmShowCycles',
    type: parseBool,
    help: 'Show approximate cycle counts in disassembly.'
});
parser.addArgument('source', {help: 'Input .asm file'});
args = parser.parseArgs();

const ok = compile(args);
if (!ok && !args.watch) {
    process.exit(1);
}

if (args.watch) {
    const ignoredPaths = [
        path.resolve(args.out)
    ];
    if (args.labelsFile && args.labelsFile !== '-') ignoredPaths.push(path.resolve(args.labelsFile));
    if (args.viceMonCommandsFile && args.viceMonCommandsFile !== '-') ignoredPaths.push(path.resolve(args.viceMonCommandsFile));
    if (args.c64debuggerSymbolsFile && args.c64debuggerSymbolsFile !== '-') ignoredPaths.push(path.resolve(args.c64debuggerSymbolsFile));
    if (args.disasmFile && args.disasmFile !== '-') ignoredPaths.push(path.resolve(args.disasmFile));

    const watcher = chokidar.watch(args.watch, {
        ignored: ignoredPaths,
        recursive:true
    })
    startDebugInfoServer();
    watcher.on('change', (path: string, stats: any) => compile(args));
}
