---
name: c64-runtime
description: Use when debugging or inspecting a C64 program's runtime behavior in VICE — not just single-stepping. Covers running/pausing/stepping execution, conditional breakpoints, reading CPU/VIC/SID/CIA registers and memory, resolving symbols, capturing screenshots, disassembling live or built code, and writing memory or CPU registers live to test fixes before editing source.
---
# C64 Runtime Skill

Use this when debugging or inspecting the runtime behavior of a C64 program in a paused VICE session and you need to find a bug.

## Golden Rule: Preserve State, Validate Fixes in Live Memory

Two facts drive every decision below:

- **A live, paused session is precious.** NEVER stop and start a new session *while actively analyzing a bug* — keep stepping through the already-paused one. Once you reach a desired state (a specific frame, a particular game situation, the exact moment a bug manifests), that state is the whole point of debugging. Do not throw it away to test a fix.
- **Source edits cost you that state.** A permanent change to an `.asm` file takes effect **only** after the session is **fully stopped and restarted** (not paused and continued). A restart **loses ALL accumulated state** — current frame, scroll position, sprite/actor positions, RNG seed, score, IRQ phase — which can be slow, fiddly, or practically impossible to reproduce.

Therefore, **validate every candidate fix in live memory before touching source**. The loop is:

> reach the desired state → probe and form a hypothesis → apply the candidate fix live with `c64jasm_setRuntimeC64Memory` → confirm it against the real, live state → **ONLY THEN** write the proven fix back to the `.asm` source and restart.

Treat the source edit + restart as the final commit of an *already-proven* change, never as the way you experiment. Lean on the **memory ↔ source-line correlation** to keep both ends aligned: `c64jasm_resolveMapping` maps a runtime address/symbol to the exact `.asm` line that produced it (and back), so a live poke traces straight to the line you will edit, and a suspect line locates precisely in RAM to patch and test in place.

**Decide whether this loop even fits the task.** Live validation is the right strategy when the bug depends on accumulated runtime state, timing, or a hard-to-reach moment. For a trivial, stateless, or obvious fix — where reaching the state is cheap and the change is unambiguous — a direct source edit + restart is simpler. Choose consciously instead of defaulting to either mode.

## Debugging Workflow

Follow this pattern, applying the Golden Rule throughout:

1. **Set targeting breakpoints first.** Use `c64jasm_manageBreakpoint` (`action: "set"`, `filePath`, `line`) at the instruction you suspect or where a subroutine begins. Pass an optional `condition` (a VICE expression such as `A == $10` or `X > 5`) to break only when it holds — ideal for catching one specific iteration of a loop.
2. **Drive execution to the state.** Use `c64jasm_manageDebugger` to `start` a session or `continue` an existing one until the C64 pauses at your breakpoint. Use `status` to check whether the machine is running or paused, and `pause` to halt a free-running session.
3. **Step and inspect, repeatedly.** Once paused, advance one line with `stepOver`, `stepInto`, or `stepOut`, and after *every single step* call `c64jasm_getRuntimeC64Memory` (e.g. `{ cpu: true }`). Observe the Processor Status Register (`P`) and registers (`A`, `X`, `Y`) to catch clobbered flags (Carry, Zero) or unexpected values, and inspect the memory ranges, VIC/SID/CIA registers where your data lives. Compare actual state against what the assembly logic intends, and continue until you spot the anomaly — a wrong branch, a wrong store, a stale flag. Use `c64jasm_resolveMapping` to tie runtime addresses/symbols back to the `.asm` line responsible (and vice versa).
4. **Disassemble when the source isn't enough.** Use `c64jasm_disassemble` to decode the actual 6502 instructions at an `address`, `symbol`, or `filePath`+`line`. `source: "live"` (default) decodes the bytes **currently in RAM**, reflecting live pokes, self-modifying code, and bank-switched code — start at a known instruction boundary (current PC, a symbol, or a source line) to avoid misaligned decoding. `source: "build"` reads the static compiled `.disasm` image and supports a negative `offset` to show preceding instructions, but does NOT reflect runtime changes.
5. **Inspect graphics visually.** For graphics bugs, call `c64jasm_getRuntimeC64Memory` with `{ screenshot: true }` to capture the live screen as a PNG, with the underlying VIC state auto-embedded (VIC-II registers, screen RAM, color RAM, sprites, charset/bitmap data). Use `{ spriteImages: true }` to render the 8 hardware sprites as individual images.
6. **Validate the fix live.** Once you have a hypothesis, prove it *without recompiling* using `c64jasm_setRuntimeC64Memory`: write a byte array (`values`) to a memory target — by `address`, `symbol`, or `filePath`+`line` — **and/or** write CPU registers via a `registers` object (`PC`, `A`, `X`, `Y`, `SP`, `P`). For example, force `A` before a routine, or set `PC` to re-run a routine from a known label. Confirm the effect against the live state before committing anything to source.
7. **Clean up, then commit.** Once the root cause is confirmed, use `c64jasm_manageBreakpoint` to `remove` a breakpoint, `removeAll`, or `list` what is set, then `continue` to restore normal execution. Only now write the proven fix into the `.asm` source and restart the session to make it permanent.

## Tool Reference

- **`c64jasm_manageDebugger`** — `action`: `start`, `stop`, `pause`, `continue`, `stepInto`, `stepOver`, `stepOut`, `status`.
- **`c64jasm_manageBreakpoint`** — `action`: `set`, `remove`, `list`, `removeAll`. `set`/`remove` take `filePath`+`line`; `set` accepts an optional VICE `condition`.
- **`c64jasm_getRuntimeC64Memory`** — selectors: `cpu`, `vic`, `sid`, `cia`, `memory` (array of `{start,end}` ranges), `symbols` (names to resolve), `screenshot` (PNG + full VIC state), `spriteImages`, `cpuHistoryCount`. Omitting all selectors returns all hardware state *except* the screenshot. **Calling this tool automatically pauses the C64.**
- **`c64jasm_resolveMapping`** — converts a source line to a memory address, or an address/symbol to a source line, using the compiler's static map. Does not require a paused session.
- **`c64jasm_setRuntimeC64Memory`** — writes `values` (byte array) to a memory target (`address`, `symbol`, or `filePath`+`line`) and/or a `registers` object (`PC`, `A`, `X`, `Y`, `SP`, `P`).
- **`c64jasm_disassemble`** — decodes 6502 instructions from an `address`, `symbol`, or `filePath`+`line`. `source`: `live` (default, current RAM) or `build` (static `.disasm`, supports `offset`). `instructionCount` defaults to 16 (max 256); `bankId` selects a VICE memory bank in live mode.
