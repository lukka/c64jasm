const { build } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const baseConfig = {
    bundle: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'node20',
    legalComments: 'linked',
    metafile: true,
    define: {
        navigator: 'undefined',
    },
};

async function main() {
    try {
        const extension = await build({
            ...baseConfig,
            entryPoints: ['client/src/extension.ts'],
            outfile: 'client/out/extension.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
        });
        await build({
            ...baseConfig,
            entryPoints: ['client/src/debugAdapter.ts'],
            outfile: 'client/out/debugAdapter.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
        });
        await build({
            ...baseConfig,
            entryPoints: ['server/src/server.ts'],
            outfile: 'server/out/server.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
        });
        await build({
            ...baseConfig,
            entryPoints: ['node_modules/c64jasm/dist/src/cli.js'],
            outfile: 'client/out/cli.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
        });
        const notices = new Map();
        for (const input of Object.keys(extension.metafile.inputs)) {
            if (!input.includes('node_modules/')) continue;
            let directory = path.dirname(path.resolve(input));
            while (directory !== path.dirname(directory)) {
                const manifest = path.join(directory, 'package.json');
                if (fs.existsSync(manifest)) {
                    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
                    const licenses = fs.readdirSync(directory).filter(name => /^(licen[cs]e|copying)([.-].*)?$/i.test(name))
                        .filter(name => fs.statSync(path.join(directory, name)).isFile())
                        .sort().map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n\n');
                    notices.set(`${pkg.name}@${pkg.version}`, `License: ${pkg.license ?? 'See package documentation'}\n${licenses}`);
                    break;
                }
                directory = path.dirname(directory);
            }
        }
        fs.writeFileSync('client/out/THIRD_PARTY_NOTICES.txt', [...notices].sort(([a], [b]) => a.localeCompare(b))
            .map(([name, license]) => `${name}\n${'='.repeat(name.length)}\n${license}`).join('\n\n') + '\n');
        console.log('Build complete');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
