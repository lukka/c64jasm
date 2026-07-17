# c64jasm DevTools

![Demo](https://raw.githubusercontent.com/lukka/c64jasm/master/vscode/media/demo.png)

Originally created by Janne Hellsten, who conceived [c64jasm](https://nurpax.github.io/c64jasm/) as a JavaScript-extensible assembler and developed both the assembler and the VS Code extension. 

In 2022, Luca began improving the extension by adding advanced debugging capabilities (such as the C64 runtime inspector) and rich code navigation features (like Find All References, Go to Definition, and hovers for well-known C64 memory addresses). Additionally, if you have a GitHub Copilot subscription, the debugger is fully integrated with the Copilot agent. The agent can read and write C64 memory, view the screen as an image, and actively assist you in developing new features or fixing bugs.

In 2026, this work is being published as a new extension with id `c64jasm-devtools`. This extension adds first-class c64jasm support to VS Code with:

- Syntax highlighting and auto-completion for c64jasm source files
- Real-time compile diagnostics while you edit
- Rich Code Navigation: Go to Definition, Find All References, and Workspace Symbol Search
- Contextual Hovers for symbols and well-known C64 memory map addresses
- Build and run/debug workflows for Commodore 64 projects with project scaffolding
- Integrated C64 runtime/debug tooling for VICE-based sessions (breakpoints, CPU/Memory/VIC/SID inspection)

## Requirements

- VS Code 1.93.0 or newer
- VICE installed and available in PATH (defaults to `x64sc`), or configured explicitly via `c64jasm-devtools.vicePath`

By default, the extension uses the bundled `c64jasm` compiler. You can switch to a system-installed compiler with `c64jasm-devtools.useEmbeddedCompiler`.

## Quick Start

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and run `c64jasm-devtools: Create New Project`.
2. Select the sample project and a destination folder. Choose to open it in VS Code right away.
3. Press `F5` to launch the debugging session. This will automatically compile your code and launch VICE for debugging using the default `c64jasm-debug` configuration created in `launch.json`.

If no custom debug configuration exists yet, use the provided `c64jasm-debug` launch configuration template.

## Extension Settings

This extension contributes the following settings:

* `c64jasm-devtools.maxNumberOfProblems`: Controls the maximum number of problems produced by the server. Defaults to `100`.
* `c64jasm-devtools.trace.server`: Traces communication between VS Code and the language server. Possible values: `off`, `messages`, `verbose`. Defaults to `off`.
* `c64jasm-devtools.useEmbeddedCompiler`: Enable or disable using the bundled `c64jasm` compiler. Defaults to `true`. If set to `false`, the extension will try to run the `c64jasm` executable from your system PATH.
* `c64jasm-devtools.vicePath`: Specifies the path to the VICE executable used when starting a debug session. Defaults to `x64sc`.
* `c64jasm-devtools.disableCopilotIntegration`: Disable all GitHub Copilot integration provided by this extension (the C64 language model tools, the `Update Copilot Assets` command, the post-update reminder, and deployment of Copilot agents, skills, and instructions into new projects). Defaults to `false`. Changing it takes effect after reloading the window.
* `c64jasm-devtools.notifyToUpdateCopilotAssets`: After the extension updates to a new version, show a reminder to refresh the bundled Copilot assets (agents and skills) in your project. Defaults to `true`. The reminder can also be dismissed permanently via its "Don't Show Again" action.

## Copilot Agents & Tools

You can leverage the `C64 Runtime agent` (along with the `c64-runtime` skill) to run Copilot agentic work: simply describe what's wrong and the agent will use the tools appropriately to step through the code and find the issue. For example, pause a debug session and ask the agent in the Content-pipe sample (you can create it using the `c64jasm-devtools: Create New Project` command):
> *"@c64-runtime-agent why are the ghosts blue? I expected them to be white or grey. The debug session is paused, check this out by stepping through the code."*

The following tools are at the agent's disposal; you don't need to invoke them directly, although you could:

* `c64jasm_manageDebugger`: Start, stop, pause, continue, step into, step over, or check status of a C64 debug session.
  > *"Start the C64 debug session"* — or — *"Step over the next instruction"*
* `c64jasm_manageBreakpoint`: Set or remove source breakpoints in `.asm` files, with optional VICE breakpoint conditions.
  > *"Set a breakpoint at line 42 of main.asm"* — or — *"Remove all breakpoints in player.asm"*
* `c64jasm_getRuntimeC64Memory`: Read runtime C64 state from VICE (CPU, VIC, SID, CIA, memory ranges, symbols) and optionally capture a screenshot.
  > *"Show me the current VIC registers"* — or — *"Read 16 bytes at $C000 and take a screenshot"*
* `c64jasm_resolveMapping`: Resolve a source file and line to a C64 memory address, or vice versa, using the static map created by the compiler (without needing to pause execution).
  > *"What memory address corresponds to line 100 in main.asm?"*
* `c64jasm_setRuntimeC64Memory`: Write bytes directly into the C64 RAM and/or set CPU registers (PC, A, X, Y, SP, P) while the emulator is running, targeting an address, symbol, or a line of code. Enables live-tweaking and validating fixes without recompiling.
  > *"Write values 0, 10, 5 to $D020 to change the border and background colors"* — or — *"Set PC to the `main_loop` label"*
* `c64jasm_disassemble`: Disassemble 6502 instructions at an address, symbol, or source line — either the bytes currently live in RAM (reflecting runtime pokes and self-modifying code) or from the static compiled image.
  > *"Disassemble 8 instructions at the `irq_handler` symbol"*

### Project Copilot assets

When you create a project with `c64jasm-devtools: Create New Project`, the extension provisions the workspace's `.github/` folder with the C64 Runtime agent, the `c64-runtime` skill, and a `copilot-instructions.md`. Those instructions tell Copilot how the project is validated: the c64jasm language server recompiles on every edit and reports the compiler's errors to the **Problems** panel, so there is no build task to run. After an extension update you can refresh the bundled agent and skill via the `c64jasm-devtools: Update Copilot Assets` command — your project's `copilot-instructions.md` is left untouched. All of this provisioning can be turned off with the `c64jasm-devtools.disableCopilotIntegration` setting.

### Availability

Copilot tools require Copilot Chat access and a VS Code version with tool support. Note that before Copilot can use third-party extension tools, you may need to explicitly enable them the first time by using the **"Chat: Configure Tools"** command from the Command Palette, or by clicking the prompt when VS Code asks for permission.

![Enabling the c64jasm DevTools tools in the Configure Tools dialog](https://raw.githubusercontent.com/lukka/c64jasm/master/vscode/media/enable-copilot-tools.png)

Learn more: 
- [Using Tools in Copilot Chat](https://code.visualstudio.com/docs/copilot/copilot-chat#_using-tools)
- [Chat Agent Mode](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode)

