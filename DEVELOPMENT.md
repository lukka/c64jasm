# Developing c64jasm

Usual development flow:

- On first run, or whenever you edit the `parser.pegjs` file: `npm run gen`
- During development, start TypeScript watch compiler to trigger rebuilds on changes: `npm run watch`
- To run tests: `npm run test`
- To compile an .asm file, run e.g. `npm run asm ./test/cases/simplest2.input.asm --disasm --out /dev/null`.  This use the same CLI as c64jasm uses when installed.

## Building an installable npm package

```
npm run dist
npm pack
```

This will produce a file called `c64jasm-<version>.tgz` (e.g., `c64jasm-v0.8.2-beta0.tgz`).

If you want to install it globally (so that you can just do `c64jasm` anywhere in your shell), do:

```
npm install -g c64jasm-<version>.tgz
```

## Building and publishing the VSCode extension

The extension id is `c64jasm-devtools` and it is published under the `lukka` publisher.

### Local install (.vsix)

```
cd vscode
pushd client && npm install && popd
npm run package
# emits build/c64jasm-devtools-<version>.vsix
# install it locally:
# code --install-extension build/c64jasm-devtools-<version>.vsix
```

`npm run package` runs the production compile via `vscode:prepublish` and writes the `.vsix` to `build/`.

### Publishing to the Marketplace

1. Bump the `version` in `vscode/package.json` — the Marketplace rejects a publish if that version already exists:

   ```
   npm version patch --no-git-tag-version   # or: minor | major
   ```

2. Authenticate once with a Personal Access Token for the `lukka` publisher (or set the `VSCE_PAT` env var):

   ```
   vsce login lukka
   ```

3. Publish. Either bump-and-publish in one step:

   ```
   vsce publish patch   # or: minor | major
   ```

   or publish a pre-built package:

   ```
   npm run package
   vsce publish --packagePath build/c64jasm-devtools-<version>.vsix
   ```
