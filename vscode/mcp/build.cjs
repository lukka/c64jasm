const { build } = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

function writeNotices(root, builds) {
    const packages = new Map();
    for (const input of builds.flatMap(result => Object.keys(result.metafile.inputs))) {
        if (!input.includes('node_modules/')) continue;
        let directory = path.dirname(path.resolve(root, input));
        while (directory !== path.dirname(directory)) {
            const manifest = path.join(directory, 'package.json');
            if (fs.existsSync(manifest)) {
                const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
                const licenses = fs.readdirSync(directory, { withFileTypes: true })
                    .filter(entry => entry.isFile() && /^(licen[cs]e|copying)([.-].*)?$/i.test(entry.name))
                    .map(entry => entry.name).sort()
                    .map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n\n');
                packages.set(`${pkg.name}@${pkg.version}`, `License: ${pkg.license ?? 'See package documentation'}\n${licenses}`);
                break;
            }
            directory = path.dirname(directory);
        }
    }
    const notices = [...packages].sort(([a], [b]) => a.localeCompare(b))
        .map(([name, license]) => `${name}\n${'='.repeat(name.length)}\n${license}`).join('\n\n');
    fs.writeFileSync(path.join(__dirname, 'dist', 'THIRD_PARTY_NOTICES.txt'), notices + '\n');
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', mainFields: ['module', 'main'], legalComments: 'linked' };
    const server = await build({
        ...common,
        absWorkingDir: root,
        entryPoints: ['mcp/src/index.ts'],
        outfile: 'mcp/dist/index.cjs',
        banner: { js: '#!/usr/bin/env node' },
        metafile: true
    });
    if (Object.values(server.metafile.outputs).some(output => output.imports.some(i => i.path === 'vscode'))) {
        throw new Error('The standalone MCP bundle must not depend on the VS Code extension host.');
    }
    const compiler = await build({
        ...common,
        absWorkingDir: root,
        entryPoints: [require.resolve('c64jasm/dist/src/cli.js', { paths: [root] })],
        outfile: path.join(__dirname, 'dist', 'cli.js'),
        metafile: true
    });
    writeNotices(root, [server, compiler]);
    fs.chmodSync(path.join(__dirname, 'dist', 'index.cjs'), 0o755);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
