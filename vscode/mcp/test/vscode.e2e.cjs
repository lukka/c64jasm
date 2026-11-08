const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');

test('real VS Code debug APIs and MCP HTTP share one VICE session in both launch directions', { timeout: 180000 }, async t => {
    assert.notEqual(process.platform, 'win32', 'The fixture launcher requires a POSIX shell.');
    const root = path.resolve(__dirname, '../..');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-vscode-e2e-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const extension = path.join(temp, 'extension');
    const out = path.join(extension, 'out');
    const project = path.join(temp, 'project');
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(path.join(project, '.vscode'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'user/User'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'user/User/settings.json'), JSON.stringify({
        'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.enableExperiments': false,
        'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'security.workspace.trust.enabled': false,
        'chat.mcp.autostart': 'never', 'workbench.startupEditor': 'none'
    }));
    fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({
        name: 'mcp-integration-host', publisher: 'c64jasm-test', version: '1.0.0', engines: { vscode: '^1.102.0' },
        main: './out/host.cjs', activationEvents: ['onStartupFinished'],
        contributes: {
            mcpServerDefinitionProviders: [{ id: 'c64jasm', label: 'c64jasm' }],
            debuggers: [{ type: 'c64jasm-debug', label: 'C64 integration test', configurationAttributes: { launch: { properties: {} } } }]
        }
    }));
    fs.writeFileSync(path.join(project, 'main.asm'), '* = $0801\n!byte $0c, $08, 0, 0, $9e, $32, $30, $36, $31, 0, 0, 0\nentry:\n    lda #1\n    sta $d020\nloop:\n    jmp loop\n');
    const viceFixture = path.join(__dirname, 'fixtures/vice.cjs');
    const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
    fs.writeFileSync(path.join(project, 'vice'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(viceFixture)} "$@"\n`, { mode: 0o755 });
    await esbuild.build({
        absWorkingDir: root, entryPoints: ['mcp/test/fixtures/vscodeHost.ts'], outfile: path.join(out, 'host.cjs'),
        bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'],
        nodePaths: [path.join(root, 'mcp/node_modules')], logLevel: 'silent'
    });
    fs.copyFileSync(path.join(root, 'mcp/dist/cli.js'), path.join(out, 'cli.js'));
    const requested = process.env.C64JASM_CODE_EXECUTABLE || 'code-insiders';
    const command = path.isAbsolute(requested) ? requested : process.env.PATH.split(path.delimiter)
        .map(directory => path.join(directory, requested)).find(file => fs.existsSync(file));
    assert.ok(command, `Cannot find ${requested}; set C64JASM_CODE_EXECUTABLE.`);
    let executable = fs.realpathSync(command);
    if (process.platform === 'darwin' && executable.includes('.app/')) {
        const directory = path.resolve(path.dirname(executable), '../../../MacOS');
        executable = path.join(directory, fs.readdirSync(directory)[0]);
    }
    const env = { ...process.env, VSCODE_SKIP_PRELAUNCH: '1', C64JASM_MCP_E2E_RESULT: path.join(temp, 'result') };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VSCODE_IPC_HOOK_CLI;
    const child = spawn(executable, [
        '--wait', '--new-window', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
        '--user-data-dir', path.join(temp, 'user'), '--extensions-dir', path.join(temp, 'extensions'),
        '--extensionDevelopmentPath', extension, '--extensionTestsPath', path.join(out, 'host.cjs'), project
    ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-18000); });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 100000);
    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => signal ? reject(new Error(`VS Code exited with ${signal}\n${output}`)) : resolve(code));
    }).finally(() => clearTimeout(timeout));
    assert.equal(code, 0, output);
    assert.ok(fs.existsSync(path.join(temp, 'result')), `VS Code did not execute the test runner.\n${output}`);
    assert.equal(fs.readFileSync(path.join(temp, 'result'), 'utf8'), 'passed', output);
});
