
var glob = require('glob-fs');

import { argv, openStdin, stdout } from 'process'
import * as path from 'path';
import * as fs from 'fs';
import * as colors from 'colors'
import { ArgumentParser } from 'argparse'

import { assemble, Diagnostic } from '../src/asm'
import * as ast  from '../src/ast'
import { DisasmOptions, disassemble } from '../src/disasm'
import { fail } from 'assert';

let verbose = false;

type Test = string;

const blacklist: Test[] = [
];

class TestReporter {
    tests: string[];

    constructor (tests: Test[], description: string) {
        this.tests = tests;
        stdout.write(`Running ${description} tests (# of tests: ${tests.length})\n`);
    }

    runTests(run: (t: Test) => 'pass' | 'fail') {
        const numTests = this.tests.length;
        let failedTests = 0;
        let skippedTests = 0;

        for (let i = 0; i < numTests; i++) {
            const test = this.tests[i];

            const skipTest = blacklist.indexOf(test) >= 0;
            if (verbose) {
                stdout.write(`Test ${i+1}/${numTests}: ${test}\n`);
                if (skipTest) {
                    stdout.write(' [test skipped]\n');
                }
            } else {
                stdout.write(`\rTest ${i+1}/${numTests}`);
            }

            if (skipTest) {
                skippedTests++;
                continue;
            }

            switch (run(test)) {
                case 'pass': {
                    // nada
                    break;
                }
                case 'fail': {
                    failedTests++;
                }
            }
        }

        if (skippedTests !== 0) {
            stdout.write(colors.yellow(`\nSkipped tests: ${skippedTests} (out of ${numTests})\n`))
        }
        if (failedTests !== 0) {
            stdout.write(colors.red(`\nFailing tests: ${failedTests} (out of ${numTests})\n`))
        } else {
            stdout.write(colors.green(`\nAll passed.\n`))
        }

        stdout.write(`\n`)
    }
}

function readLines(fname: string) {
    const lines = fs.readFileSync(fname).toString().split('\n');
    return lines.map(line => line.trimRight());
}

function outputTest(testcase: string) {
    const g = glob();
    let inputs = g.readdirSync('test/cases/*.input.asm').filter((t: string) => testcase ? t == testcase : true);

    const runTest = (fname: string) => {
        const lines = fs.readFileSync(fname).toString().split('\n');
        const disasmOptions: DisasmOptions = {
            showLabels: false,
            showCycles: false,
        };

        const { prg, errors, debugInfo } = assemble(fname)!;

        if (lines.length > 0) {
            const match = /;\s+disasm:\s+(.*)/.exec(lines[0]);
            if (match !== null) {
                const opts = match[1].split(' ');
                disasmOptions.showCycles = opts.includes('cycles');
                if (opts.includes('debuginfo')) {
                    disasmOptions.isInstruction = debugInfo!.info().isInstruction;
                }
            }
        }

        if (errors.length > 0) {
            console.error(errors);
            return 'fail';
        }

        const disasmLines = disassemble(prg, undefined, disasmOptions).concat('');
        const expectedFname = path.join(path.dirname(fname), path.basename(fname, 'input.asm') + 'expected.asm');
        const actualFname = path.join(path.dirname(fname), path.basename(fname, 'input.asm') + 'actual.asm');

        // If the expected file doesn't exist, create it.  This is for new test authoring.
        if (!fs.existsSync(expectedFname)) {
            fs.writeFileSync(expectedFname, disasmLines.join('\n'))
            stdout.write(`\n  DEBUG: wrote ${expectedFname}\n`);
            return 'pass';
        }
        const expectedLines = readLines(expectedFname);
        for (let lineIdx = 0; lineIdx < expectedLines.length; lineIdx++) {
            if (expectedLines[lineIdx].trim() != disasmLines[lineIdx].trim()) {
                stdout.write(`\n${colors.red(`Test ${fname} failed`)}\n`)
                fs.writeFileSync(actualFname, disasmLines.join('\n'));
                console.error(`Test failed.
Input .asm:

cat ${fname}

First delta on line ${lineIdx+1}.

Expected disassembly (from ${expectedFname}):

${expectedLines.join('\n')}

Actual disassembly (also written into ${actualFname}):

${disasmLines.join('\n')}

To gild to actual output:

cp ${actualFname} ${expectedFname}

`);
                return 'fail';
            }
        }
        return 'pass'
    };

    const reporter = new TestReporter(inputs, 'assembly');
    reporter.runTests(runTest);
}

function cleanSyntaxError(msg: string) {
    const fwdSlashesMsg = msg.replace(/\\/g, '/');
    const m = /(((.*): error:) (Syntax error: )).*$/.exec(fwdSlashesMsg);
    if (m) {
        return m[1];
    }
    return fwdSlashesMsg;
}

function validateErrors(errors: Diagnostic[], fname: string, errType: 'error' | 'warning') {
    const errorMessages = errors.map(e => cleanSyntaxError(e.formatted));
    const errorsFname = path.join(path.dirname(fname), path.basename(fname, 'input.asm') + `${errType}s.txt`);

    // If the expected file doesn't exist, create it.  This is for new test authoring.
    if (!fs.existsSync(errorsFname)) {
        const errLines = errorMessages.join('\n')
        fs.writeFileSync(errorsFname, errLines)
        console.log(`  DEBUG: wrote ${errorsFname}`);
        console.log(errLines + '\n')
        return 'pass';
    } else {
        const expectedErrors = readLines(errorsFname);
        for (let ei in expectedErrors) {
            const cleanedExpected = cleanSyntaxError(expectedErrors[ei])
            const emsg = /^(.*:.* - |.*: (?:error|warning): )(.*)$/.exec(cleanedExpected);
            const msgOnly = emsg![2];

            const found = errorMessages.some((msg) => {
                const m = /^(.*:.* - |.*: (?:error|warning): )(.*)$/.exec(msg);
                return m ? m[2] == msgOnly : false;
            });
            if (!found) {
                const actualFname = path.join(path.dirname(fname), path.basename(fname, 'input.asm') + `actual_${errType}s.txt`);
                fs.writeFileSync(actualFname, errorMessages.join('\n'))
                console.error(`Assembler output does not contain errors listed in

${errorsFname}

Actual errors written into

${actualFname}

To gild actual:

cp ${actualFname} ${errorsFname}
`);
                return 'fail';
            }
        }
        if (expectedErrors.length !== errors.length) {
            const actualFname = path.join(path.dirname(fname), path.basename(fname, 'input.asm') + `actual_${errType}s.txt`);
            fs.writeFileSync(actualFname, errorMessages.join('\n'))
            console.log(`Expected to see ${expectedErrors.length}, but compiler produced ${errors.length} errors.

Actual errors written to ${actualFname}

To gild actual:

cp ${actualFname} ${errorsFname}
`);
            return 'fail';
        }
        return 'pass';
    }
}

function testErrors(testcase: string) {
    const g = glob();
    let inputs = g.readdirSync('test/errors/*.input.asm').filter((t: string) => testcase ? t == testcase : true);

    const reporter = new TestReporter(inputs, 'error');
    reporter.runTests((fname: string) => {
        const { errors } = assemble(fname)!;
        return validateErrors(errors, fname, 'error');
    });
}

function testWarnings(testcase: string) {
    const g = glob();
    let inputs: string[] = [];
    try {
        inputs = g.readdirSync('test/warnings/*.input.asm').filter((t: string) => testcase ? t == testcase : true);
    } catch(e) {
        // no warnings tests
    }

    const reporter = new TestReporter(inputs, 'warning');
    reporter.runTests((fname: string) => {
        const { warnings } = assemble(fname)!;
        return validateErrors(warnings, fname, 'warning');
    });
}

const parser = new ArgumentParser({
    addHelp: true,
    description: 'Run c64jasm tests'
});

parser.addArgument('--verbose', {
    action:'storeConst',
    constant:true,
    help: 'Output extra debug information'
});

parser.addArgument('--test', {
    help: 'Test case to run (default is to run all)'
});

const args = parser.parseArgs();
if (args.verbose) {
    verbose = true;
}

const hrstart = process.hrtime();

outputTest(args.test);
testErrors(args.test);
testWarnings(args.test);

if (verbose) {
    const NS_PER_SEC = 1e9;
    const diff = process.hrtime(hrstart);
    const deltaNS = diff[0] * NS_PER_SEC + diff[1];
    console.info('Tests completed in %d ms', Math.floor((deltaNS/1000000.0)*100)/100);
}
