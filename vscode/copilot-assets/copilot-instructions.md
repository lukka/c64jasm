# Copilot instructions for this c64jasm project

This is a Commodore 64 assembly project built with the **c64jasm** assembler and
the c64jasm DevTools VS Code extension.

## Validating your code (compile errors)

The c64jasm compiler validates the project for you **continuously** — you do
**not** need to run a build task to find errors.

- The extension's c64jasm language server recompiles the project (starting from
  the entry point declared in `c64jasm.json`) every time a `.asm` file is edited
  or saved, and publishes the compiler's errors and warnings to the VS Code
  **Problems** panel.
- **The entries in the Problems panel ARE the c64jasm compiler diagnostics.** To
  check whether your changes compile, read the Problems panel (use the
  `get_errors` tool). Do **not** run a separate build/compile task just to
  surface errors — there is no build task to run, and the compiler has already
  validated the code.
- After an edit, allow a moment for the language server to recompile, then
  re-check the Problems panel for the file you changed and for the entry point
  (`src/main.asm` by default).

## Building and running

To actually assemble and run the program, start the **c64jasm debugger** launch
configuration in `.vscode/launch.json`. This runs the bundled (provided) c64jasm
compiler in watch mode, produces `out/<name>.prg`, and launches it in the VICE
emulator. Use this for running and debugging — not for routine error checking,
which the Problems panel already covers.

## Project layout

- `c64jasm.json` — declares the project entry point (`source`); the language
  server compiles from there.
- `src/` — your assembly sources (`.asm`) and any JavaScript plugins (`.js`).
- `out/` — generated build artifacts (`.prg`, `.disasm`); do not edit by hand.
