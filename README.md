# c64jasm

This repository contains:

- **[c64jasm DevTools](vscode/README.md)** - the [c64jasm DevTools extension for VS Code](https://marketplace.visualstudio.com/items?itemName=lukka.c64jasm-devtools), adding syntax highlighting, compile diagnostics, rich code navigation, and integrated C64 debugging.

- **[c64jasm DevTools MCP server](vscode/mcp/README.md)** - a standalone server for Codex and other MCP clients. Its six tools compile and debug C64 projects with VICE, manage breakpoints, inspect and change memory and CPU registers, resolve source mappings, disassemble code, and return screenshots and sprite images. Requires Node.js 20+ and VICE; includes the compiler and runs independently of VS Code and Copilot. See the [Codex setup instructions](vscode/mcp/README.md#connect-codex).

- **[c64jasm](DEVELOPMENT.md)** - a fork of [c64jasm](https://nurpax.github.io/c64jasm), a c64 6510 macro assembler, which is also embedded into the VS Code [c64jasm DevTools](vscode/README.md) extension.
