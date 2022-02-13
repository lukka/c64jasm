const { build } = require('esbuild');

const baseConfig = {
    bundle: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'node12',
};

async function main() {
    try {
        await build({
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
        console.log('Build complete');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
