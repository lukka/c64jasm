// Copyright (c) 2025-2026 Luca Cappa. All rights reserved.

// @ts-strict-ignore
import {
    Logger, logger,
    LoggingDebugSession,
    InitializedEvent, TerminatedEvent, ExitedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
    Thread, Breakpoint, Handles, Scope, ContinuedEvent, Event
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { C64jasmRuntime, C64Regs } from './c64jasmRuntime';
import * as utils from './utils'
import { WebAppPanel } from './web';
import { c64Palette } from './c64Palette';
import { writePng } from './writePng';
import { instructions6502, formatInstructionHover } from './instructions6502';
import { normalizeHexAddress, lookupHardwareRegister, formatHardwareRegisterHover } from './c64hardware';
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
    extensionMode?: number;
    /** Path to VICE executable */
    vicePath?: string;
    /** Use the embedded c64jasm compiler instead of the system-wide executable */
    useEmbeddedCompiler?: boolean;
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
    
    private pendingTerminalCallbacks: ((response: any) => void)[] = [];

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
            if (this._configurationDone) {
                this.sendEvent(new StoppedEvent(reason, C64jasmDebugSession.THREAD_ID));
            } else {
                this._bufferedStopReason = reason;
            }
            WebAppPanel.currentPanel.value?.webview?.postMessage({ type: 'debugStopped' });
            // Request sprite-related memory when debugger stops
            this.requestSpriteData();
        });
        this.runtime.on('continue', () => {
            WebAppPanel.currentPanel.value?.webview?.postMessage({ type: 'debugContinued' });
            this.sendEvent(new ContinuedEvent(C64jasmDebugSession.THREAD_ID));
        });
        this.runtime.on('breakpointValidated', (bp) => {
            this.sendEvent(new BreakpointEvent('changed',
                { verified: bp.verified, id: bp.id } as DebugProtocol.Breakpoint));
        });
        this.runtime.on('output', (text, category = "console") => {
            const e: DebugProtocol.OutputEvent = new OutputEvent(text ? text + '\n' : '\n');
            e.body.category = category;
            this.sendEvent(e);
        });
        this.runtime.on('end', () => {
            this.sendEvent(new TerminatedEvent());
        });
        this.runtime.on('runInTerminal', (args: any, _timeout: number, cb: (response: any) => void) => {
            const title: string = args.title || '';
            if (title.startsWith('VICE')) {
                this.pendingTerminalCallbacks.push(cb);
                this.sendEvent(new Event('c64jasm:manageTerminal', { action: 'create', args: args.args }));
            } else {
                this.runInTerminalRequest(args, _timeout, cb);
            }
        });
        this.runtime.on('message', (msg) => {
            this.sendEvent(new Event('message', msg));
        });
        this.runtime.on('started', () => {
            this.sendEvent(new Event('started'));
        });
        this.runtime.on('registers', (regs, invRegs) => {
            WebAppPanel.currentPanel.value?.webview?.postMessage({ regs: regs, invRegs: invRegs });
        });
        this.runtime.on('memory', (memory) => {
            WebAppPanel.currentPanel.value?.webview?.postMessage({ memory: memory });
        });
    }

    private cleanupSession(): void {
        this.runtime.removeAllListeners();
        if (C64jasmDebugSession.activeSession === this) {
            C64jasmDebugSession.activeSession = null;
        }
    }

    public shutdown(): void {
        this.sendEvent(new Event('c64jasm:manageTerminal', { action: 'dispose' }));
        this.cleanupSession();
        super.shutdown();
    }

    protected customRequest(command: string, response: DebugProtocol.Response, args: any, request?: DebugProtocol.Request): void {
        if (command === 'c64jasm:terminalCreated') {
            const cb = this.pendingTerminalCallbacks.shift();
            if (cb) {
                if (args && args.error) {
                    cb({ success: false, message: args.error });
                } else {
                    cb({ 
                        success: true, 
                        body: { processId: args?.processId || null, shellProcessId: args?.processId || null } 
                    });
                }
            }
            this.sendResponse(response);
            return;
        }
        super.customRequest(command, response, args, request);
    }

    private _configurationDone = false;
    private _bufferedStopReason: string | undefined;

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

        // We delay InitializedEvent until launchRequest finishes executing, so that
        // the client sends breakpoints AFTER the binary protocol connection is established.
    }

    /**
     * Called at the end of the configuration sequence.
     * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
     */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
        this._configurationDone = true;
        if (this._bufferedStopReason) {
            this.sendEvent(new StoppedEvent(this._bufferedStopReason, C64jasmDebugSession.THREAD_ID));
            this._bufferedStopReason = undefined;
        }
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        await utils.wrapOp(`launchRequest`, response, async () => {
            const vicePath: string = args.vicePath || "x64sc";
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

            WebAppPanel.memoryBatchRequestHandler = async (requests: Array<{start: number, end: number, bankId?: number, tag: string}>) => {
                return await this.runtime.retrieveMemoryBatch(requests);
            };

            WebAppPanel.banksRequestHandler = async () => {
                return await this.runtime.getAvailableBanks();
            };

            // Set up memory set handler for webview
            WebAppPanel.memorySetHandler = async (address: number, value: number) => {
                await this.runtime.writeMemory(address, value);
            };

            // Set up register set handler for webview
            WebAppPanel.registerSetHandler = async (register: string, value: number) => {
                await this.runtime.writeRegister(register, value);
            };

            // Set up screenshot request handler
            WebAppPanel.screenshotRequestHandler = async () => {
                const response = await this.runtime.getScreenshot();
                if (!response.imageData?.length) throw new Error("Failed to capture screenshot.");
                let rgba = response.imageData;
                if (response.bpp === 8) {
                    rgba = Buffer.alloc(response.debugWidth * response.debugHeight * 4);
                    for (let i = 0; i < response.imageData.length; i++) {
                        rgba.set([...(c64Palette[response.imageData[i] & 0x0F] || c64Palette[0]), 255], i * 4);
                    }
                }
                const pngBuffer = writePng(response.debugWidth, response.debugHeight, rgba);

                return {
                    width: response.debugWidth,
                    height: response.debugHeight,
                    bpp: response.bpp,
                    data: Buffer.from(pngBuffer).toString('base64')
                };
            };

            // start the program in the runtime
            await this.runtime.start(args.program, !!args.stopOnEntry, vicePath, source, disasm, args.extensionMode, args.useEmbeddedCompiler);

            // Emitting InitializedEvent signals the frontend that the debug adapter is ready
            // to answer configuration requests (such as setBreakpointsRequest).
            // We emit this *after* the runtime is started and the binary protocol connections 
            // to VICE are fully established so breakpoint setup doesn't fail.
            this.sendEvent(new InitializedEvent());
        }, this);
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse): Promise<void> {
        await utils.wrapOp(`terminateRequest`, response, async () => {
            await this.runtime.terminate();
            this.cleanupSession();
        }, this);

        this.sendEvent(new TerminatedEvent(0));
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
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
                response.body = {
                    breakpoints: Array.from(this.runtime.getAllBreakpoints()).map(bps => {
                        const bpp = new Breakpoint(bps.verified, bps.line);
                        bpp.setId(bps.id);
                        return bpp;
                    })
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
            const stackFrames = (await this.runtime.stackTrace()) || [];
            response.body = { stackFrames, totalFrames: stackFrames.length };
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
            // Check expandableValues first — it stores per-register/per-value refs.
            // variableHandles (the "registers_" scope) is checked only as a fallback,
            // avoiding collisions between the two separate Handles instances whose
            // auto-incrementing counters both start at 1.
            const item = this.expandableValues.get(args.variablesReference);
            if (item) {
                if (item.type === 'array') {
                    // Expand array to show individual elements
                    try {
                        const memHex = await this.runtime.retrieveMemory(item.addr, item.addr + item.size - 1, 0);
                        const bytes = (memHex.match(/.{1,2}/g) || []).map(b => parseInt(b, 16));

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
            } else {
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
        WebAppPanel.currentPanel.value?.webview?.postMessage({ type: 'debugContinued' });
        await utils.wrapOp(`nextRequest`, response, async () => {
            await this.runtime.next();
            // The stepOver stopped event will be fired by the runtime when the emulator actually stops
        }, this);
        this.sendResponse(response);
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
        WebAppPanel.currentPanel.value?.webview?.postMessage({ type: 'debugContinued' });
        await utils.wrapOp(`stepInRequest`, response, async () => {
            await this.runtime.step();
            // The stepIn stopped event will be fired by the runtime when the emulator actually stops
        }, this);
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
        WebAppPanel.currentPanel.value?.webview?.postMessage({ type: 'debugContinued' });
        await utils.wrapOp(`stepOutRequest`, response, async () => {
            await this.runtime.stepOut();
            // The stepOut stopped event will be fired by the runtime when the emulator actually stops
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
                    const evalResult = utils.evaluateMathExpression(expr, (name) => this.runtime.lookupSymbol(name));
                    if (evalResult !== undefined && evalResult >= 0 && evalResult <= 0xFFFF) {
                        symbol = { name: expr, addr: evalResult, size: 1 };
                    }
                }

                if (!symbol) {
                    const parsedAddress = expr.startsWith('$') ? parseInt(expr.substring(1), 16) :
                                          expr.toLowerCase().startsWith('0x') ? parseInt(expr.substring(2), 16) :
                                          /^\d+$/.test(expr) ? parseInt(expr, 10) : undefined;
                                          
                    if (parsedAddress !== undefined && parsedAddress >= 0 && parsedAddress <= 0xFFFF) {
                        symbol = { name: expr, addr: parsedAddress, size: 1 };
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
        if (!WebAppPanel.currentPanel.value?.webview) {
            return;
        }

        try {
            // Send current CPU register state to webview
            const { regs, regsInv } = await this.runtime.retrieveRegistersWithInv();
            if (regs && regsInv) {
                WebAppPanel.currentPanel.value?.webview?.postMessage({ regs, invRegs: regsInv });
            }

            const banks = await this.runtime.getAvailableBanks();
            const findBankId = (name: string): number | undefined => {
                const bank = banks.find(b => b.name === name);
                return bank?.id;
            };
            const getPreferredBankId = (...names: string[]): number => {
                for (const name of names) {
                    const id = findBankId(name);
                    if (id !== undefined) return id;
                }
                return 0;
            };

            const ioBankId = getPreferredBankId("io", "cpu", "default");
            const ramBankId = getPreferredBankId("ram", "cpu", "default");

            // Request VIC-II registers ($D000-$D02E)
            const vicRegs = await this.runtime.retrieveMemory(0xd000, 0xd02e, ioBankId);
            WebAppPanel.currentPanel.value?.webview?.postMessage({
                memory: vicRegs,
                tag: "vicRegs"
            });

            const cia2Base = await this.runtime.retrieveMemory(0xdd00, 0xdd00, ioBankId);
            WebAppPanel.currentPanel.value?.webview?.postMessage({
                memory: cia2Base,
                tag: "cia2Base"
            });

            // Parse the live VIC/CIA state so screen and charset addresses match the
            // actual VIC-II bank and current text/bitmap mode.
            const vicBytes = (vicRegs && typeof vicRegs === 'string')
                ? (vicRegs.replace(/\s/g, '').match(/.{1,2}/g) || []).map(b => parseInt(b, 16))
                : [];
            const ciaBytes = (cia2Base && typeof cia2Base === 'string')
                ? (cia2Base.replace(/\s/g, '').match(/.{1,2}/g) || []).map(b => parseInt(b, 16))
                : [];

            const d011 = vicBytes[0x11] || 0x1b;
            const d018 = vicBytes[0x18] || 0x14;
            const vicBankBase = (3 - ((ciaBytes[0] || 0x03) & 0x03)) * 0x4000;
            const isBitmapMode = ((d011 >> 5) & 1) === 1;

            const screenAddr = vicBankBase + (((d018 >> 4) & 0x0F) * 0x0400);
            const charsetAddr = isBitmapMode
                ? vicBankBase + ((d018 & 0x08) ? 0x2000 : 0x0000)
                : vicBankBase + (((d018 >> 1) & 0x07) * 0x0800);

            console.log(
                `VIC-II $D011: ${d011.toString(16)}, $D018: ${d018.toString(16)}, ` +
                `bank base: $${vicBankBase.toString(16)}, screen: $${screenAddr.toString(16)}, ` +
                `charset/bitmap: $${charsetAddr.toString(16)}`
            );

            const spritePointers = await this.runtime.retrieveMemory(
                screenAddr + 0x03f8,
                screenAddr + 0x03ff,
                ramBankId
            );
            WebAppPanel.currentPanel.value?.webview?.postMessage({
                memory: spritePointers,
                tag: "spritePointers"
            });

            const screenMemory = await this.runtime.retrieveMemory(screenAddr, screenAddr + 999, ramBankId);
            WebAppPanel.currentPanel.value?.webview?.postMessage({
                memory: screenMemory,
                tag: "screenMemory"
            });

            const colorMemory = await this.runtime.retrieveMemory(0xd800, 0xdbe7, ioBankId);
            WebAppPanel.currentPanel.value?.webview?.postMessage({
                memory: colorMemory,
                tag: "colorMemory"
            });

            let actualCharsetAddr = charsetAddr;
            let charsetBank = ramBankId;
            if (
                (charsetAddr >= 0x1000 && charsetAddr <= 0x1FFF) ||
                (charsetAddr >= 0x9000 && charsetAddr <= 0x9FFF)
            ) {
                actualCharsetAddr = 0xD000 + (charsetAddr & 0x0FFF);
                charsetBank = findBankId("rom") ?? ramBankId;
            }

            const charsetLength = isBitmapMode ? 7999 : 2047;

            try {
                const charsetMemory = await this.runtime.retrieveMemory(
                    actualCharsetAddr,
                    actualCharsetAddr + charsetLength,
                    charsetBank
                );
                WebAppPanel.currentPanel.value?.webview?.postMessage({
                    memory: charsetMemory,
                    tag: "charsetMemory"
                });
            } catch (err) {
                console.error(`Failed to read charset/bitmap memory from bank ${charsetBank} at $${actualCharsetAddr.toString(16)}: ${err}`);
                try {
                    const fallbackMemory = await this.runtime.retrieveMemory(
                        charsetAddr,
                        charsetAddr + charsetLength,
                        ramBankId
                    );
                    WebAppPanel.currentPanel.value?.webview?.postMessage({
                        memory: fallbackMemory,
                        tag: "charsetMemory"
                    });
                } catch (fallbackErr) {
                    console.error(`Fallback charset read also failed: ${fallbackErr}`);
                }
            }
        } catch (err) {
            console.error(`Failed to request sprite data: ${err}`);
        }
    }
}
