---
name: c64-step-debugging
description: Use when the C64 debugger is stopped at a section of code that is hard to find a bug into. Steps through the code and inspects registers and memory at each step to understand the problem.
---
# C64 Step-by-Step Debugging Skill

When the C64 debugger is paused at a complex or hard-to-understand section of code and you need to find a bug:

**CRITICAL**: NEVER stop and start a new debugging session *while actively analyzing a bug*. Always keep analyzing and stepping through the existing, already paused session.
**HOWEVER**, if a permanent change to the source file is made, the change takes effect **only** if the debug session is **stopped and restarted**. Not paused and continued, but completely stopped and restarted.
*Alternatively*, use `c64jasm-setRuntimeC64Memory` to push bytes live into RAM to verify your fix on the fly before rewriting the actual source files, which saves time.

1. **Step Through the Code**: Use the `c64jasm-manageDebugger` tool with the `step` action to execute the code instruction by instruction.
2. **Inspect Machine State**: After every single step, use the `c64jasm-getRuntimeC64Memory` tool to:
   - Check CPU registers (A, X, Y, PC, SP, Status flags).
   - Inspect relevant memory ranges where variables or data are stored.
   - Check VIC or SID registers if the bug is related to graphics or audio.
3. **Analyze the Flow**: Compare the actual state (registers/memory) against the expected state according to the assembly logic.
4. **Identify the Anomaly**: Continue this process until you spot an instruction doing something unexpected, such as branching incorrectly or storing the wrong value.

## Debugging Workflow & Tools

To effectively debug issues, strictly follow this pattern using the provided extension tools:

1. **Set Targeting Breakpoints First**: Before starting the debugger or continuing execution, use `c64jasm-manageBreakpoint` (`action: "set"`, `filePath`, `line`) at the specific instruction you suspect the bug stems from or where a specific subroutine begins. 
2. **Control Execution**: Use `c64jasm-manageDebugger` to `start` a session or `continue` an existing one until the C64 execution pauses at your newly set breakpoint.
3. **Step Through the Code**: Once paused, use `c64jasm-manageDebugger` with `stepOver` or `stepInto` one line at a time. Do this patiently to track flow through subroutines or loops.
4. **Continuously Inspect State**: After *every single step*, call `c64jasm-getRuntimeC64Memory` with `{ cpu: true }`. This is critical: you must observe the Processor Status Register (`P`) and general registers (`A`, `X`, `Y`) to spot when flags (like Carry or Zero) are clobbered or when unexpected values are loaded by intervening operations. Use `c64jasm-resolveMapping` if you need to trace where specific runtime memory pointers originate in the `.asm` files.
5. **Live Tweaking**: Test logic without compiling by directly modifying variable values, opcodes, or data tables using the `c64jasm-setRuntimeC64Memory` tool. You can supply the source code location (`filePath` and `line`) or the symbol name and directly swap the backing bytes in memory.
6. **Clean Up**: Once the root cause is identified (e.g., an instruction overwriting a necessary flag), use `c64jasm-manageBreakpoint` (`action: "remove"`) to clean up the targeted breakpoint, and finally `continue` the debugger to restore normal execution.
