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

/**
 * This interface describes the C64jasm-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the C64jasm-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
}

export class C64jasmDebugSession extends LoggingDebugSession {

    // we don't support multiple threads, so we can use a hardcoded ID for the default thread
    private static THREAD_ID = 1;

    private variableHandles = new Handles<string>();
    private regsCache: C64Regs | null;
    private regsMap: { [hash: number]: { id: string, name: string, bytes: number, value: number } } = {};
    //??private regsMapInv: { [name: string]: { hash: number } } = {};

    // a C64jasm runtime (or debugger)
    private _runtime: C64jasmRuntime;

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor() {
        super("c64jasm-debug.txt");

        // this debugger uses zero-based lines and columns
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);

        this._runtime = new C64jasmRuntime();

        // setup event handlers
        this._runtime.on('stop', (reason) => {
            this.sendEvent(new StoppedEvent(reason, C64jasmDebugSession.THREAD_ID));
        });
        this._runtime.on('continue', () => {
            this.sendEvent(new ContinuedEvent(C64jasmDebugSession.THREAD_ID));
        });
        this._runtime.on('breakpointValidated', (bp) => {
            this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
        });
        this._runtime.on('output', (text, category = "console") => {
            const e: DebugProtocol.OutputEvent = new OutputEvent(text || '');
            e.body.category = category;
            this.sendEvent(e);
        });
        this._runtime.on('end', () => {
            this.sendEvent(new TerminatedEvent());
        });
        this._runtime.on('runInTerminal', (args, timeout, cb) => {
            this.runInTerminalRequest(args, timeout, cb);
        });
        this._runtime.on('message', (msg) => {
            const e = new Event('message', msg);
            this.sendEvent(e);
        });
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
        await utils.wrapOp(`launchRequest`, response, async () => {
            const vicePath: string = vscode.workspace.getConfiguration().get("c64jasm-client.vicePath", "x64");
            // make sure to 'Stop' the buffered logging if 'trace' is not set
            logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);
            // start the program in the runtime
            await this._runtime.start(args.program, !!args.stopOnEntry, vicePath);
        });
        this.sendResponse(response);
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse): Promise<void> {
        await utils.wrapOp(`terminateRequest`, response, async () => {
            await this._runtime.terminate();
        });
        this.sendResponse(response);

        this.sendEvent(new TerminatedEvent(0));
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse) {
        await utils.wrapOp(`disconnectRequest`, response, async () => {
            // TODO this probably shouldn't terminate VICE but rather just exit the
            // remote monitor
            this._runtime.terminate();
        });
        this.sendResponse(response);

        this.sendEvent(new ExitedEvent(0));
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
        let ok = false;
        await utils.wrapOp(`setBreakPointsRequest`, response, async () => {
            const path: string | undefined = args.source.path;
            if (!path) {
                //?? should an message/output sent over the client as well?
                throw new Error("the path to the file to put the breakpoint is not set");
            }
            const clientLines: number[] = args.lines || [];
            if (this._runtime && path) {
                // clear all breakpoints for this file and set new breakpoints
                await this._runtime.clearBreakpoints(path);
                const actualBreakpoints = await Promise.all(clientLines.map(async l => {
                    let { verified, line, id } =
                        await this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
                    const bp: DebugProtocol.Breakpoint =
                        new Breakpoint(verified, this.convertDebuggerLineToClient(line));
                    bp.id = id;
                    return bp;
                }));
                ok = true;
                // send back the actual breakpoint positions
                response.body = {
                    breakpoints: actualBreakpoints
                };
            }
        });
        response.success = ok;
        this.sendResponse(response);
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
        await utils.wrapOp(`threadsRequest`, response, async () => {
            // runtime supports now threads so just return a default thread.
            response.body = {
                threads: [
                    new Thread(C64jasmDebugSession.THREAD_ID, "thread 1")
                ]
            };
        });
        this.sendResponse(response);
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
        await utils.wrapOp(`stackTraceRequest`, response, async () => {
            const stk = this._runtime.stack();
            if (stk) {
                response.body = { stackFrames: [stk], totalFrames: 1 };
            } else {
                response.body = { stackFrames: [], totalFrames: 0 };
            }
        });
        this.sendResponse(response);
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
        });
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const variables = new Array<DebugProtocol.Variable>();
        const addReg = (name: string, v: string, ref: number) => {
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
                const regs: C64Regs | null = await this._runtime.retrieveRegisters();
                if (regs) {
                    this.regsCache = regs;
                    try {
                        for (const r in this.regsCache) {
                            const hash = 0;//??this.regsMapInv[key].hash;
                            const v: number = this.regsCache[r].value;
                            const bytes: number = this.regsCache[r].byteCount;
                            addReg(this.regsCache[r].name.padStart(3, " "),
                                `0x${utils.toBase(v, 16, bytes * 2 /* hex: 2 chars per byte */)}` +
                                `\t (${utils.toBase(v, 10, 0)})`,
                                hash);
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
                // Specific register request.
                const reg = this.regsMap[args.variablesReference];
                const v: number = (this.regsCache as any)[reg.name];
                addReg("bin", `${utils.toBase(v, 2, 8 * reg.bytes /*bin: 8 chars per byte */)}`, 0);
            }
        });
        response.body = {
            variables: variables
        };
        this.sendResponse(response);
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
        });
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.sendResponse(response)
        utils.wrapOp(`continueRequest`, response, async () => {
            this._runtime.continue();
        });
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        await utils.wrapOp(`nextRequest`, response, async () => {
            await this._runtime.next();
            this.sendEvent(new StoppedEvent("stepOver", C64jasmDebugSession.THREAD_ID));
        });
        this.sendResponse(response);
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
        await utils.wrapOp(`stepInRequest`, response, async () => {
            await this._runtime.step();
            this.sendEvent(new StoppedEvent("stepIn", C64jasmDebugSession.THREAD_ID));
        });
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): Promise<void> {
        await utils.wrapOp(`pauseRequest`, response, async () => {
            await this._runtime.pause();
            this.sendEvent(new StoppedEvent("pause", C64jasmDebugSession.THREAD_ID));
        });
        this.sendResponse(response);
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
        await utils.wrapOp(`evaluateRequest`, response, async () => {
            let reply: string | undefined = undefined;

            if (args.context === 'repl') {
                reply = await this._runtime.textCommand(args.expression + '\n');
            }

            response.body = {
                result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
                variablesReference: 0
            };
        });
        this.sendResponse(response);
    }
}
