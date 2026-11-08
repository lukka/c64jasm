# c64jasm DevTools MCP server

A standalone stdio MCP server exposing the six c64jasm debugger tools to Codex CLI
and other stdio-compatible MCP clients. It launches its own VICE process and starts
or connects to a c64jasm compiler watcher. This is the primary setup for Codex CLI
without VS Code. The memory, mapping, disassembly, and image tools share their
implementation with the VS Code extension's MCP backend.

To control an existing VS Code F5/debug UI session and editor breakpoints instead,
use the extension's separate authenticated loopback Streamable HTTP server labeled
`c64jasm`; see the [extension connection instructions](https://github.com/lukka/c64jasm/blob/main/vscode/README.md#connect-external-clients-to-the-vs-code-session).
That requires a client supporting Streamable HTTP and authentication headers. This
stdio package does not attach to VS Code. Choose the transport/backend explicitly;
there is no client-name detection or automatic fallback.

## Requirements

- Node.js 20 or later.
- VICE with binary monitor support, with `x64sc` on PATH or an explicit executable
  supplied through `--vice-path`.
- c64jasm source with a BASIC `SYS` startup header, as used by the sample projects.

The `c64jasm-devtools-mcp` npm package includes this fork's compiler and its JavaScript
dependencies. It uses the same fork-local compiler build embedded in the VS Code
extension. Users only install the MCP package; a separate `c64jasm` installation,
VS Code, and the extension are not required.

## Install

Install a release tarball:

```sh
npm install -g ./c64jasm-devtools-mcp-0.1.0.tgz
```

Once the new `c64jasm-devtools-mcp` package is published to npm, users can install it by
name instead:

```sh
npm install -g c64jasm-devtools-mcp
```

Configure the MCP client to launch `c64jasm-devtools-mcp`, with `--project` and, if needed,
`--vice-path`. The installed server automatically launches its embedded compiler.
The build steps below are for maintainers and source-checkout users.

## Build from source

From `vscode/`, after installing the extension's dependencies:

```sh
npm --prefix mcp ci
npm run compile:mcp
npm run test:mcp
```

For a fresh repository checkout, first build and vendor the compiler using the
same preparation as the extension. From the repository root:

```sh
npm ci
node scripts/vendor-core.js
cd vscode
npm install
npm --prefix mcp ci
npm run compile:mcp
```

The output is `mcp/dist/index.cjs` and the bundled compiler `mcp/dist/cli.js`,
plus license notices. The `dist/` directory can be copied to another machine;
keep both JavaScript files together. No `node_modules` directory is needed to
run the bundles.

The compiler is bundled from the local `vscode/vendor/c64jasm.tgz` dependency
prepared by `scripts/vendor-core.js`, including its server-mode changes. This
compiler is a build input, not a published npm dependency of `c64jasm-devtools-mcp`.

## Connect Codex

Use this standalone stdio setup for Codex CLI without running VS Code.
Register the built server, replacing both paths with absolute paths:

```sh
codex mcp add c64jasm -- node /absolute/path/to/vscode/mcp/dist/index.cjs --project /absolute/path/to/c64-project
codex mcp list
```

To select a VICE executable explicitly, append
`--vice-path /absolute/path/to/x64sc` to the server command.

Alternatively, add this to `~/.codex/config.toml` or the project's
`.codex/config.toml`:

```toml
[mcp_servers.c64jasm]
command = "node"
args = ["/absolute/path/to/vscode/mcp/dist/index.cjs", "--project", "/absolute/path/to/c64-project"]
tool_timeout_sec = 120
```

The longer tool timeout allows for compiler startup and VICE autostart. Start a
new Codex session after changing its MCP configuration. In the Codex CLI, `/mcp`
shows the available server. These settings follow the
[official Codex MCP documentation](https://developers.openai.com/codex/mcp).

Example prompts:

- "Start the C64 debugger and pause at entry."
- "Set a breakpoint at line 42 of src/main.asm, then continue."
- "Read the CPU registers and show a screenshot."
- "Disassemble eight instructions at the main_loop symbol."

## Session control

A client connected to this stdio server controls its session by calling
`c64jasm_manageDebugger`. The client launches the MCP server; VICE starts when the
agent requests `start`.

| Tool arguments | Behavior |
| --- | --- |
| `{"action":"start"}` | Build the project, launch VICE, connect its binary monitor, and pause at entry. Set `stopOnEntry` to `false` to run immediately. |
| `{"action":"pause"}` | Halt the C64 through the VICE binary monitor. |
| `{"action":"continue"}` | Resume execution. |
| `{"action":"stop"}` | End the VICE session and stop the compiler watcher started by this server. The MCP server remains available for another launch. |
| `{"action":"status"}` | Report whether a session is active and whether it is paused or running. |

The MCP controller calls the shared debugger runtime directly. Each standalone
server process owns one VICE session and serializes its tool calls. Separate
stdio processes and VS Code control separate VICE sessions; clients using the
extension's HTTP endpoint share VS Code's session instead. An existing compiler
service may be reused when it already builds the requested program; shutdown
only terminates processes started by this server.

## Project configuration

`--project` defaults to the server's working directory. The server reads
`c64jasm.json` in that directory to find the source:

```json
{ "source": "src/main.asm" }
```

Without this file, it uses `main.asm`. By default it builds
`out/<source-name>.prg` and `out/<source-name>.disasm`. A start request can
override `projectPath`, `sourcePath`, `programPath`, `disasmPath`, `vicePath`,
`stopOnEntry`, or `useEmbeddedCompiler`. Launch paths resolve relative to the
project directory. Use absolute source paths for mapping, reads, and writes.

To use an existing `.vscode/launch.json` entry, pass `configName` to the start
action. The server accepts JSON comments and trailing commas and uses the
configuration's `program`, `source`, `disasm`, `stopOnEntry`, `vicePath`, and
`useEmbeddedCompiler` fields. It expands `${workspaceFolder}`. Other VS Code
variables and tasks require the VS Code host; supply explicit paths for the
standalone server.

`--system-compiler` runs `c64jasm` from PATH instead of the bundled compiler.
`--help` and `--version` print usage and version information.

## Tools

| Tool | Actions or parameters |
| --- | --- |
| `c64jasm_manageDebugger` | `start`, `stop`, `pause`, `continue`, `stepInto`, `stepOver`, `stepOut`, `status` |
| `c64jasm_manageBreakpoint` | `set`, `remove`, `list`, `removeAll`; source file, 1-based line, optional VICE condition |
| `c64jasm_getRuntimeC64Memory` | CPU, VIC-II, SID, CIA, memory ranges, symbols, `cpuHistoryCount`, `screenshot`, `spriteImages` |
| `c64jasm_resolveMapping` | Address or symbol to source, or source file and line to address |
| `c64jasm_setRuntimeC64Memory` | Byte arrays at an address, symbol, or source line; CPU registers |
| `c64jasm_disassemble` | Live or compiled instructions at an address, symbol, or source line |

Addresses accept decimal numbers or hexadecimal strings such as `"$D020"`,
`"0xD020"`, and `"D020"`. Start a session before reading runtime state or
resolving mappings. Reading runtime state pauses execution; use `continue` to
resume it. Omitting read options returns hardware state without images.
Screenshots and sprite images are returned as MCP PNG image content.

The compiler watches source changes. Restart the debug session to load a new
build into VICE. Compiler output is logged to
`<program-directory>/.c64jasm/<program-name>.server.log`. The MCP server sends
diagnostics to stderr and reserves stdout for JSON-RPC. It serializes tool calls
and terminates the compiler watcher and VICE process it started when stdin closes or the
server receives SIGINT/SIGTERM. Breakpoints persist across session restarts for
the lifetime of the server.

Cancelling a queued call prevents it from running. Cancelling a launch cleans up
its processes; cancelling a pending step pauses VICE before the next call runs.
Memory or register writes already sent to VICE remain applied.

## Package

From `vscode/mcp/`:

```sh
npm pack
```

The resulting tarball is the complete npm distribution:

```text
c64jasm-devtools-mcp/
  dist/index.cjs              MCP server and shared debugger runtime
  dist/cli.js                 Forked c64jasm compiler with server mode
  dist/THIRD_PARTY_NOTICES.txt Bundled dependency notices
  package.json
  README.md
```

Only `c64jasm-devtools-mcp` needs to be published to npm. Maintainers build and test it
using the local fork, then publish the generated `c64jasm-devtools-mcp-<version>.tgz`.
The forked compiler requires no separate npm release. The same tarball can also
be distributed as a GitHub release asset.

Once installed:

```sh
codex mcp add c64jasm -- c64jasm-devtools-mcp --project /absolute/path/to/c64-project
```

## Validation

`npm run test:mcp` from `vscode/` checks the actual stdio handshake, tool
discovery, input validation, error results, and portable bundles. It also packs
the npm package, installs it offline in a temporary directory, verifies the
embedded compiler's version, and runs a complete debugging flow using that
installed package with the real bundled compiler and a fixture implementing
the VICE binary monitor protocol. The fixture covers launch, source mapping,
breakpoints, reads and writes, sprite colors, images, stepping, restart,
cancellation, rejected or malformed monitor replies, invalid startup headers,
and process cleanup, including shutdown during launch.
An installed VICE instance is not required for these automated tests.

For the real VS Code end-to-end check, run from `vscode/`:

```sh
npm run test:mcp:vscode
```

This uses an installed `code-insiders` by default. To select another compatible
VS Code executable:

```sh
C64JASM_CODE_EXECUTABLE=/absolute/path/to/code-insiders npm run test:mcp:vscode
```

The check uses an isolated VS Code profile and a POSIX VICE fixture, so no real
VICE installation is needed. It does not modify the real user's clipboard.
