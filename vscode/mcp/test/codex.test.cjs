const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const executable = process.env.C64JASM_CODEX_EXECUTABLE || 'codex';
const available = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000 });

test('installed Codex CLI accepts independent stdio and optional VS Code HTTP connections', {
    skip: available.error?.code === 'ENOENT' && 'Codex CLI is not installed.'
}, t => {
    assert.equal(available.status, 0, available.error?.message ?? available.stderr);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c64jasm-codex-config-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const command = args => {
        const result = spawnSync(executable, args, {
            cwd: temp, env: { ...process.env, CODEX_HOME: temp }, encoding: 'utf8', timeout: 10000
        });
        assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? result.stdout);
        return result.stdout;
    };
    const bundle = path.resolve(__dirname, '../dist/index.cjs');
    command(['mcp', 'add', 'c64jasm-standalone', '--', process.execPath, bundle, '--project', temp]);
    const standalone = JSON.parse(command(['mcp', 'get', 'c64jasm-standalone', '--json']));
    assert.equal(standalone.transport.type, 'stdio');
    assert.equal(standalone.transport.command, process.execPath);
    assert.deepEqual(standalone.transport.args, [bundle, '--project', temp]);
    command(['mcp', 'add', 'c64jasm-vscode', '--url', 'http://127.0.0.1:1/mcp', '--bearer-token-env-var', 'C64JASM_MCP_TOKEN']);
    const vscode = JSON.parse(command(['mcp', 'get', 'c64jasm-vscode', '--json']));
    assert.equal(vscode.transport.type, 'streamable_http');
    assert.equal(vscode.transport.url, 'http://127.0.0.1:1/mcp');
    assert.equal(vscode.transport.bearer_token_env_var, 'C64JASM_MCP_TOKEN');
});
