// @ts-strict-ignore
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, ExitedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
    Thread, Breakpoint, Handles, Scope, ContinuedEvent, Event
} from 'vscode-debugadapter';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { C64jasmRuntime, C64Regs } from './c64jasmRuntime';
import * as utils from './utils'
import { WebAppPanel } from './web';
import { instructions6502, formatInstructionHover, lookupHardwareRegister, formatHardwareRegisterHover } from './instructions6502';
import { normalizeHexAddress } from './c64hardware';
import * as config from './config';

/**
 * This interface describes the C64jasm-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the C64jasm-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** An absolute path to the source file to compile. */
    source?: string;
    /** An absolute path to the disasm file. */
    disasm?: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
    /** Extension mode (Development, Production, or Test) */
    extensionMode?: vscode.ExtensionMode;
}

/**
 * Check if a register name represents the processor status register.
 * VICE may send it as "FL" (flags) or "P" (processor status).
 */
function isStatusRegister(name: string): boolean {
    return name === "FL" || name === "P";
}

/**
 * A debug adapter that interfaces between VS Code and a C64jasm runtime (or debugger).
 * The adapter runs inside the extension host of VS Code.
 * @see https://microsoft.github.io/debug-adapter-protocol//specification.html
 */
export class C64jasmDebugSession extends LoggingDebugSession {

    // we don't support multiple threads, so we can use a hardcoded ID for the default thread
    private static readonly THREAD_ID: number = 1;

    // Track the currently active debug session to prevent multiple simultaneous sessions
    private static activeSession: C64jasmDebugSession | null = null;

    private variableHandles = new Handles<string>();
    private regsCache: C64Regs | null;
    private expandableValues = new Handles<
        { type: 'value', name: string, value: number, bytes: number } |
        { type: 'array', name: string, addr: number, size: number }
    >();

    // a C64jasm runtime (or debugger) - singleton instance
    private runtime: C64jasmRuntime;

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor() {
        super("c64jasm-debug.txt");

        // Enforce single active session
        if (C64jasmDebugSession.activeSession) {
            C64jasmDebugSession.activeSession.shutdown();
        }
        C64jasmDebugSession.activeSession = this;

        // this debugger uses one-based lines and columns
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);

        // Use the singleton runtime instance
        this.runtime = C64jasmRuntime.getInstance();

        // setup event handlers
        this.runtime.on('stop', (reason) => {
            this.sendEvent(new StoppedEvent(reason, C64jasmDebugSession.THREAD_ID));
            // Request sprite-related memory when debugger stops
            this.requestSpriteData();
        });
        this.runtime.on('continue', () => {
            this.sendEvent(new ContinuedEvent(C64jasmDebugSession.THREAD_ID));
        });
        this.runtime.on('breakpointValidated', (bp) => {
            this.sendEvent(new BreakpointEvent('changed',
                { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
        });
        this.runtime.on('output', (text, category = "console") => {
            const e: DebugProtocol.OutputEvent = new OutputEvent(text || '');
            e.body.category = category;
            this.sendEvent(e);
        });
        this.runtime.on('end', () => {
            this.sendEvent(new TerminatedEvent());
        });
        this.runtime.on('runInTerminal', (args, timeout, cb) => {
            this.runInTerminalRequest(args, timeout, cb);
        });
        this.runtime.on('message', (msg) => {
            this.sendEvent(new Event('message', msg));
        });
        this.runtime.on('started', () => {
            this.sendEvent(new Event('started'));
        });
        this.runtime.on('registers', (regs, invRegs) => {
            WebAppPanel.currentPanel.webview?.postMessage({ regs: regs, invRegs: invRegs });
        });
        this.runtime.on('memory', (memory) => {
            WebAppPanel.currentPanel?.webview?.postMessage({ memory: memory });
        });
    }

    private cleanupSession(): void {
        this.runtime.removeAllListeners();
        if (C64jasmDebugSession.activeSession === this) {
            C64jasmDebugSession.activeSession = null;
        }
    }

    public shutdown(): void {
        this.cleanupSession();
        super.shutdown();
    }

    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {
        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};

        // the adapter implements the configurationDoneRequest.
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsValueFormattingOptions = true;
        response.body.supportTerminateDebuggee = true;
        response.body.supportsTerminateRequest = true;
        response.body.supportsBreakpointLocationsRequest = false;
        response.body.supportsSetVariable = true;
        response.body.supportsDisassembleRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsLoadedSourcesRequest = true;
        response.body.supportsConditionalBreakpoints = true;

        this.sendResponse(response);

        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent());
    }

    /**
     * Called at the end of the configuration sequence.
     * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
     */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        try {
            await utils.wrapOp(`launchRequest`, response, async () => {
                const vicePath: string = vscode.workspace.getConfiguration().get("c64jasm-client.vicePath", "x64");
                // make sure to 'Stop' the buffered logging if 'trace' is not set
                logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

                let source = args.source;
                if (!source) {
                    source = config.resolveSource();
                }

                if (!source) {
                    throw new Error("Source file not specified. Please provide 'source' in launch.json or 'source' property in c64jasm.json.");
                }

                let disasm = args.disasm;
                if (!disasm && source) {
                    disasm = config.resolveDisasm(source);
                }

                // Set up memory request handler for webview
                WebAppPanel.memoryRequestHandler = async (start: number, end: number, bankId: number) => {
                    return await this.runtime.retrieveMemory(start, end, bankId);
                };

                // Set up memory set handler for webview
                WebAppPanel.memorySetHandler = async (address: number, value: number) => {
                    await this.runtime.writeMemory(address, value);
                };

                // Set up register set handler for webview
                WebAppPanel.registerSetHandler = async (register: string, value: number) => {
                    await this.runtime.writeRegister(register, value);
                };

                // start the program in the runtime
                await this.runtime.start(args.program, !!args.stopOnEntry, vicePath, source, disasm, args.extensionMode);
            }, this);
        }
        finally {
        }
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse): Promise<void> {
        await utils.wrapOp(`terminateRequest`, response, async () => {
            await this.runtime.terminate();
            this.cleanupSession();
        }, this);

        this.sendEvent(new TerminatedEvent(0));
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse) {
        await utils.wrapOp(`disconnectRequest`, response, async () => {
            // TODO this probably shouldn't terminate VICE but rather just exit the
            // remote monitor
            await this.runtime.terminate();
            this.cleanupSession();
        }, this);

        this.sendEvent(new ExitedEvent(0));
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
        await utils.wrapOp(`setBreakPointsRequest`, response, async () => {
            const path: string | undefined = args.source.path;
            if (!path) {
                //?? should an message/output sent over the client as well?
                throw new Error(`setBreakPointsRequest(): the source path is not set. Args: ${args}`);
            }
            const sourceBps = args.breakpoints || [];
            if (this.runtime) {
                // clear all breakpoints for this file and set new breakpoints
                // (state preservation is now handled automatically in the runtime layer)
                await this.runtime.clearBreakpoints(path);
                await Promise.all(sourceBps.map(
                    async l => {
                        let { verified, line, id } =
                            await this.runtime.setBreakpoint(path, this.convertClientLineToDebugger(l.line), l.condition);
                        const bp: DebugProtocol.Breakpoint =
                            new Breakpoint(verified, this.convertDebuggerLineToClient(line));
                        bp.id = id;
                        return bp;
                    }));
                await this.runtime.verifyBreakpoints(path);

                // send back the actual breakpoint positions
                var bbb: DebugProtocol.Breakpoint[] = [];
                for (var bps of this.runtime.getAllBreakpoints()) {
                    var bpp = new Breakpoint(bps.verified, bps.line)
                    bpp.setId(bps.id);
                    bbb.push(bpp);
                }
                response.body = {
                    breakpoints: bbb
                };
            }
        }, this);
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
        await utils.wrapOp(`threadsRequest`, response, async () => {
            // runtime supports now threads so just return a default thread.
            response.body = {
                threads: [
                    new Thread(C64jasmDebugSession.THREAD_ID, "thread 1")
                ]
            };
        }, this);
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
        await utils.wrapOp(`stackTraceRequest`, response, async () => {
            const stackFrames = await this.runtime.stackTrace();
            if (stackFrames && stackFrames.length > 0) {
                response.body = { stackFrames: stackFrames, totalFrames: stackFrames.length };
            } else {
                response.body = { stackFrames: [], totalFrames: 0 };
            }
        }, this);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        utils.wrapOpSync(`scopesRequest`, response, () => {
            const frameReference: number = args.frameId;
            const scopes: Scope[] = [];
            scopes.push(
                new Scope("Registers",
                    this.variableHandles.create("registers_" + frameReference),
                    false));
            response.body = {
                scopes: scopes
            };
        }, this);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const variables = new Array<DebugProtocol.Variable>();
        const addReg = (name: string, v: string, value: number, bytes: number) => {
            const ref = this.expandableValues.create({ type: 'value', name, value, bytes });
            variables.push({
                name: name,
                type: 'register',
                presentationHint: { kind: "data" },
                value: v,
                variablesReference: ref
            });
        };

        await utils.wrapOp(`variablesRequest`, response, async () => {
            const id = this.variableHandles.get(args.variablesReference);
            if (id && id.startsWith("registers_")) {
                const regs: C64Regs | null = await this.runtime.retrieveRegisters();
                if (regs) {
                    this.regsCache = regs;
                    try {
                        for (const r in this.regsCache) {
                            const v: number = this.regsCache[r].value;
                            const bytes: number = this.regsCache[r].byteCount;
                            const regName = this.regsCache[r].name;

                            let regString: string;
                            // Special case for status flag register (aka P).
                            // Format: NV-BDIZC where uppercase = set (1), lowercase = clear (0)
                            if (isStatusRegister(regName)) {
                                const flag = (bit: number, char: string) => (v & bit) ? char.toUpperCase() : char.toLowerCase();
                                regString = `${flag(0x80, 'n')}${flag(0x40, 'v')}-${flag(0x10, 'b')}${flag(0x08, 'd')}${flag(0x04, 'i')}${flag(0x02, 'z')}${flag(0x01, 'c')}`;
                            } else {
                                regString = `0x${utils.toBase(v, 16, bytes * 2 /* hex: 2 chars per byte */)}` +
                                    `\t (${utils.toBase(v, 10, 0)})`;
                            }

                            addReg(regName, regString, v, bytes);
                        };
                    } catch (error) {
                        const e = error as Error;
                        if (e) {
                            console.error(e.stack);
                            throw new Error(`Failed to parse registers: ${e.message} ${e.stack}`);
                        } else {
                            console.error(error);
                        }
                    }
                } else {
                    throw new Error("Cannot retrieve registers");
                }
            } else {
                // Handle expandable value (register, watch expression, or array)
                const item = this.expandableValues.get(args.variablesReference);
                if (item) {
                    if (item.type === 'array') {
                        // Expand array to show individual elements
                        try {
                            const memHex = await this.runtime.retrieveMemory(item.addr, item.addr + item.size - 1, 0);
                            const bytes: number[] = [];
                            for (let i = 0; i < memHex.length; i += 2) {
                                bytes.push(parseInt(memHex.substr(i, 2), 16));
                            }

                            // Create variables for each array element
                            for (let i = 0; i < bytes.length && i < item.size; i++) {
                                const val = bytes[i];
                                const elemRef = this.expandableValues.create({ type: 'value', name: `${item.name}[${i}]`, value: val, bytes: 1 });
                                variables.push({
                                    name: `[${i}]`,
                                    value: `$${val.toString(16).toUpperCase().padStart(2, '0')} (${val})`,
                                    type: 'byte',
                                    variablesReference: elemRef
                                });
                            }
                        } catch (err) {
                            variables.push({
                                name: "error",
                                value: `Failed to read array: ${err}`,
                                variablesReference: 0
                            });
                        }
                    } else if (item.type === 'value') {
                        // For status register, only show individual flags
                        if (isStatusRegister(item.name)) {
                            const flag = (bit: number, name: string) => {
                                variables.push({
                                    name: name,
                                    value: (item.value & bit) ? "1" : "0",
                                    variablesReference: 0
                                });
                            };
                            flag(0x80, "N (Negative)");
                            flag(0x40, "V (Overflow)");
                            flag(0x10, "B (Break)");
                            flag(0x08, "D (Decimal)");
                            flag(0x04, "I (Interrupt)");
                            flag(0x02, "Z (Zero)");
                            flag(0x01, "C (Carry)");
                        } else {
                            // For other registers/values, show different number formats
                            variables.push({
                                name: "binary",
                                value: `0b${utils.toBase(item.value, 2, item.bytes * 8)}`,
                                variablesReference: 0
                            });
                            variables.push({
                                name: "hex",
                                value: `0x${utils.toBase(item.value, 16, item.bytes * 2)}`,
                                variablesReference: 0
                            });
                            variables.push({
                                name: "decimal",
                                value: `${item.value}`,
                                variablesReference: 0
                            });
                        }
                    }
                }
            }
            response.body = {
                variables: variables
            };
        }, this);
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments, request?: DebugProtocol.Request): Promise<void> {
        utils.wrapOp(`continueRequest`, response, async () => {
            throw new Error("Not supported yet");
            /*const ref = args.variablesReference;
            const addr = ref & VariablesReferenceFlag.ADDR_MASK
            if (ref & VariablesReferenceFlag.REGISTERS) {
                const res = await this._runtime.setRegisterVariable(args.name, parseInt(args.value));
                response.body = {
                    value: res.value,
                    variablesReference: 0,
                };
            }
            else {
                throw new Error('You can only modify registers and globals');
            }*/
            response.success = true;
        }, this);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.sendResponse(response)
        utils.wrapOp(`continueRequest`, response, async () => {
            this.runtime.continue();
        }, this);
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        await utils.wrapOp(`nextRequest`, response, async () => {
            await this.runtime.next();
            this.sendEvent(new StoppedEvent("stepOver", C64jasmDebugSession.THREAD_ID));
        }, this);
        this.sendResponse(response);
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
        await utils.wrapOp(`stepInRequest`, response, async () => {
            await this.runtime.step();
            this.sendEvent(new StoppedEvent("stepIn", C64jasmDebugSession.THREAD_ID));
        }, this);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): Promise<void> {
        await utils.wrapOp(`pauseRequest`, response, async () => {
            await this.runtime.pause();
            this.sendEvent(new StoppedEvent("pause", C64jasmDebugSession.THREAD_ID));
        }, this);
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
        await utils.wrapOp(`evaluateRequest`, response, async () => {
            let reply: string | undefined = undefined;

            if (args.context === 'repl') {
                // For REPL, return the full VICE monitor output
                reply = await this.runtime.textCommand(args.expression + '\n');
            } else if (args.context === 'watch' || args.context === 'hover') {
                // For watch/hover, first check if it's a 6502 instruction
                const expr = args.expression.trim();

                // Check for hardware register (hex address like $d000)
                if (expr.match(/^\$[0-9a-fA-F]+$/)) {
                    const register = lookupHardwareRegister(expr);
                    if (register && args.context === 'hover') {
                        // Return hardware register information for hover
                        const normalizedAddr = normalizeHexAddress(expr);
                        reply = formatHardwareRegisterHover(normalizedAddr, register);
                        response.body = {
                            result: reply,
                            variablesReference: 0
                        };
                        return;
                    }
                }

                // Check for 6502 instruction (case-insensitive, 3-letter mnemonics)
                const instruction = instructions6502[expr.toLowerCase()];
                if (instruction && args.context === 'hover') {
                    // Return instruction information for hover
                    reply = formatInstructionHover(instruction);
                    response.body = {
                        result: reply,
                        variablesReference: 0
                    };
                    return;
                }

                // Otherwise, try to lookup symbol for complete information
                let symbol = this.runtime.lookupSymbol(expr);

                if (!symbol) {
                    let parsedAddress: number | undefined = undefined;
                    if (expr.match(/^\$[0-9a-fA-F]+$/i)) {
                        parsedAddress = parseInt(expr.substring(1), 16);
                    } else if (expr.match(/^0x[0-9a-fA-F]+$/i)) {
                        parsedAddress = parseInt(expr.substring(2), 16);
                    } else if (expr.match(/^[0-9]+$/)) {
                        parsedAddress = parseInt(expr, 10);
                    }

                    if (parsedAddress !== undefined && parsedAddress >= 0 && parsedAddress <= 0xFFFF) {
                        symbol = {
                            name: expr,
                            addr: parsedAddress,
                            size: 1 // Default to 1 byte for raw addresses
                        };
                    }
                }

                let variablesReference = 0;

                if (symbol) {
                    // Check if this is a variable (has value but no addr)
                    if (symbol.addr === undefined && symbol.value !== undefined) {
                        // Variable - show value only
                        const val = symbol.value;
                        if (typeof val === 'number') {
                            reply = `$${val.toString(16).toUpperCase()} (${val})`;
                        } else if (typeof val === 'string') {
                            reply = `"${val}"`;
                        } else if (typeof val === 'boolean') {
                            reply = val ? 'true' : 'false';
                        } else {
                            reply = String(val);
                        }
                    } else if (symbol.addr !== undefined && symbol.size !== undefined) {
                        // Symbol with address - show address and value based on size
                        const addr = symbol.addr;
                        const size = symbol.size;
                        const addrStr = `$${addr.toString(16).toUpperCase()} (${addr})`;

                        if (size === 0) {
                            // Just an address label (code label), no data
                            reply = addrStr;
                        } else if (size === 1) {
                            // Single byte - read and show value
                            try {
                                const memHex = await this.runtime.retrieveMemory(addr, addr, 0);
                                const val = parseInt(memHex.substr(0, 2), 16);
                                reply = `${addrStr} = $${val.toString(16).toUpperCase().padStart(2, '0')} (${val})`;
                                variablesReference = this.expandableValues.create({ type: 'value', name: symbol.name, value: val, bytes: 1 });
                            } catch (err) {
                                reply = `${addrStr} (read error)`;
                            }
                        } else if (size === 2) {
                            // Two bytes - show as 16-bit little-endian value
                            try {
                                const memHex = await this.runtime.retrieveMemory(addr, addr + 1, 0);
                                const lo = parseInt(memHex.substr(0, 2), 16);
                                const hi = parseInt(memHex.substr(2, 2), 16);
                                const val = lo | (hi << 8);
                                reply = `${addrStr} = $${val.toString(16).toUpperCase().padStart(4, '0')} (${val})`;
                                variablesReference = this.expandableValues.create({ type: 'value', name: symbol.name, value: val, bytes: 2 });
                            } catch (err) {
                                reply = `${addrStr} (read error)`;
                            }
                        } else if (size > 2) {
                            // Array - create expandable
                            reply = `${addrStr} [${size} bytes]`;
                            variablesReference = this.expandableValues.create({ type: 'array', name: symbol.name, addr: addr, size: size });
                        }
                    }
                }
                // For hover context, if no symbol found, don't attempt textCommand as it's not implemented
                // For watch context, we could try other methods but for now just leave empty

                response.body = {
                    result: reply || '',
                    variablesReference: variablesReference
                };
                return;
            }

            response.body = {
                result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
                variablesReference: 0
            };
        }, this);
    }

    protected async disassembleRequest(response: DebugProtocol.DisassembleResponse, args: DebugProtocol.DisassembleArguments): Promise<void> {
        await utils.wrapOp(`disassembleRequest`, response, async () => {
            const instructions = await this.runtime.disassemble(args.memoryReference, args.instructionCount, args.offset || 0);
            response.body = {
                instructions: instructions
            };
        }, this);
    }

    protected async loadedSourcesRequest(response: DebugProtocol.LoadedSourcesResponse, args: DebugProtocol.LoadedSourcesArguments): Promise<void> {
        await utils.wrapOp(`loadedSourcesRequest`, response, async () => {
            const sources = this.runtime.getLoadedSources();
            response.body = {
                sources: sources
            };
        }, this);
    }

    private async requestSpriteData(): Promise<void> {
        if (!WebAppPanel.currentPanel?.webview) {
            return;
        }

        try {
            // Check if runtime was running before querying sprite data
            const wasRunning = await this.runtime.isRunning();

            // Send current CPU register state to webview
            const { regs, regsInv } = await this.runtime.retrieveRegistersWithInv();
            if (regs && regsInv) {
                WebAppPanel.currentPanel.webview.postMessage({ regs, invRegs: regsInv });
            }

            // Request VIC-II registers ($D000-$D02E)
            const vicRegs = await this.runtime.retrieveMemory(0xd000, 0xd02e, 0);
            WebAppPanel.currentPanel.webview.postMessage({
                memory: vicRegs,
                tag: "vicRegs"
            });

            // Parse VIC-II register $D018 to determine screen and charset locations
            // Extract the hex bytes from vicRegs string
            const vicBytes: number[] = [];
            if (vicRegs && typeof vicRegs === 'string') {
                const cleaned = vicRegs.replace(/\s/g, '');
                for (let i = 0; i < cleaned.length; i += 2) {
                    const byte = parseInt(cleaned.substr(i, 2), 16);
                    if (!isNaN(byte)) {
                        vicBytes.push(byte);
                    }
                }
            }

            // $D018 is at offset 0x18 in VIC-II registers
            const d018 = vicBytes[0x18] || 0x15; // Default value
            const vmBase = (d018 >> 4) & 0x0F; // Video Matrix base (bits 4-7)
            const cbBase = (d018 >> 1) & 0x07; // Character Base (bits 1-3)

            // Calculate actual addresses (relative to VIC-II bank, assume bank 0 for now)
            const screenAddr = vmBase * 0x0400; // Screen RAM address
            const charsetAddr = cbBase * 0x0800; // Character ROM/RAM address

            console.log(`VIC-II $D018: ${d018.toString(16)}, Screen: $${screenAddr.toString(16)}, Charset: $${charsetAddr.toString(16)}`);

            // Request sprite pointers ($07F8-$07FF)
            const spritePointers = await this.runtime.retrieveMemory(0x07f8, 0x07ff, 0);
            WebAppPanel.currentPanel.webview.postMessage({
                memory: spritePointers,
                tag: "spritePointers"
            });

            // Request screen memory using calculated address
            const screenMemory = await this.runtime.retrieveMemory(screenAddr, screenAddr + 999, 0);
            WebAppPanel.currentPanel.webview.postMessage({
                memory: screenMemory,
                tag: "screenMemory"
            });

            // Request color memory ($D800-$DBE7, 1000 bytes)
            const colorMemory = await this.runtime.retrieveMemory(0xd800, 0xdbe7, 0);
            WebAppPanel.currentPanel.webview.postMessage({
                memory: colorMemory,
                tag: "colorMemory"
            });

            // Request character memory using calculated address
            // Character ROM in VIC bank 0 appears at $1000-$1FFF (cbBase 2-3),
            // but CPU sees I/O at $D000-$DFFF. We need to read from the actual ROM.
            // When charsetAddr is in ROM range ($1000-$1FFF), try reading from Character ROM with bank 1 (all RAM with ROM visible)
            let actualCharsetAddr = charsetAddr;
            let charsetBank = 0;

            // Check if charset is in Character ROM range (VIC bank 0, addresses $1000-$1FFF)
            if (charsetAddr >= 0x1000 && charsetAddr <= 0x1FFF) {
                // This points to Character ROM. Try reading from $D000-$DFFF with bank 1 (RAM+ROM view)
                // Map VIC address to actual ROM address: $D000-$DFFF
                actualCharsetAddr = 0xD000 + (charsetAddr - 0x1000);
                charsetBank = 1; // Bank 1 typically provides RAM+ROM view
                console.log(`Charset in ROM range ($${charsetAddr.toString(16)}), reading from bank ${charsetBank} at $${actualCharsetAddr.toString(16)}`);
            }

            try {
                const charsetMemory = await this.runtime.retrieveMemory(actualCharsetAddr, actualCharsetAddr + 2047, charsetBank);
                WebAppPanel.currentPanel.webview.postMessage({
                    memory: charsetMemory,
                    tag: "charsetMemory"
                });
            } catch (err) {
                console.error(`Failed to read charset memory from bank ${charsetBank} at $${actualCharsetAddr.toString(16)}: ${err}`);
                // Fallback: try reading from bank 0 (might get zeros but won't crash)
                try {
                    const fallbackMemory = await this.runtime.retrieveMemory(charsetAddr, charsetAddr + 2047, 0);
                    WebAppPanel.currentPanel.webview.postMessage({
                        memory: fallbackMemory,
                        tag: "charsetMemory"
                    });
                } catch (fallbackErr) {
                    console.error(`Fallback charset read also failed: ${fallbackErr}`);
                }
            }

            // Resume execution if it was running before
            if (wasRunning) {
                await this.runtime.continue();
            }
        } catch (err) {
            console.error(`Failed to request sprite data: ${err}`);
        }
    }
}
