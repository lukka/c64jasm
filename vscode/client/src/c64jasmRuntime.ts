import * as fs from 'fs';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import { StackFrame, Source } from 'vscode-debugadapter';
import * as vscode from 'vscode';
import * as utils from './utils';
import { mkdir } from 'fs/promises';
import * as getport from 'get-port';
import * as cmd from './viceCommands';
import { SocketWrapper } from './socketWrapper';
import { performance } from 'perf_hooks';

/**
 * Check if a register name represents the processor status register.
 * VICE may send it as "FL" (flags) or "P" (processor status).
 */
function isStatusRegister(name: string): boolean {
    return name === "FL" || name === "P";
}

type DataEaterResult = number;
type DataEaterFunction = (buffer: Buffer) => DataEaterResult;

export interface C64jasmBreakpoint {
    id: number;
    line: number;
    verified: boolean;
    condition?: string;
    checkpointId?: number;
};

export type C64Regs = {
    [id: number]: {
        name: string;
        byteCount: number;
        value: number;
    }
};

export type C64RegsInv = { [name: string]: { id: number } };

type QueueType = {
    promise: () => Promise<cmd.Response | null>,
    resolve: (value: cmd.Response | null) => void,
    reject: (reason?: any) => void
};

class MonitorConnection extends EventEmitter {
    static readonly localhost: string = "localhost";
    private readonly socket: SocketWrapper;
    private readonly binarySocket: SocketWrapper;
    private echo: (str: string) => void;
    private workingOnPromise: boolean = false;
    private queue: QueueType[] = [];
    private requestId: number = 0;
    private getRequestId(): number { return ++this.requestId; }
    private stopped: boolean = false;
    private responseEater: DataEaterFunction | null;
    private buffer: Buffer | null = null;
    private regs: C64Regs | null = null;
    private regsInv: C64RegsInv | null = null;
    private disposed: boolean = false;
    private abortController: AbortController;
    private isInitializing: boolean = true;
    private wasRunningBeforeOperation: boolean = false;
    private expectingStopOnEntry: boolean = false;
    private hasResumedAfterCheckpoint: boolean = false;
    private entryPointAddress: number | undefined = undefined;
    private connectionEstablished: boolean = false;

    constructor(
        echo: (str: string) => void,
        monitorPort: number,
        binaryPort: number,
        abortController: AbortController) {
        super();
        this.abortController = abortController;
        this.socket = new SocketWrapper(MonitorConnection.localhost, monitorPort, abortController.signal);
        this.binarySocket = new SocketWrapper(MonitorConnection.localhost, binaryPort, abortController.signal);
        this.echo = echo;
        this.binarySocket.on('data', this.handleIncomingData.bind(this));
        this.binarySocket.on('close', () => {
            if (!this.disposed && this.connectionEstablished) {
                this.emit('quit');
            }
        });
    }

    public async sendRequestCustom<T extends cmd.Response>(req: cmd.Request<T>,
        dataEater: DataEaterFunction): Promise<T> {
        return this.enqueue(async () => await this.sendRequestCustomAsync(req, dataEater)) as Promise<T>;
    }

    private async sendRequestCustomAsync<T extends cmd.Response>(req: cmd.Request<T>,
        dataEater: DataEaterFunction): Promise<cmd.Response | null> {
        const p = new Promise<cmd.Response>(async (resolve, reject) => {
            req.setId(this.getRequestId());
            this.responseEater = dataEater;
            this.echo('Request sent to VICEMON: ' + req.toString());
            await this.binarySocket.writeBinary(req.getBuffer());
            const TIMEOUT_MS = 5000;
            let timeStart = performance.now();
            while (!req.tryGetResponse()) {
                await utils.delay(50);
                if ((performance.now() - timeStart) > TIMEOUT_MS) break;
            }
            const resp: T = req.tryGetResponse();
            if (!resp) {
                reject(new Error(`Timeout waiting for answer of ${req.toString()}`));
            } else {
                this.echo(`Response from VICEMON: ${resp.toString()}`);
                resolve(resp);
            }
        });
        return await p.finally(() => this.responseEater = null);
    }

    public sendRequest<T extends cmd.Response>(req: cmd.Request<T>, waitResponse: boolean = true): Promise<T> {
        return this.enqueue(async () => await this.sendRequestAsync(req, waitResponse)) as Promise<T>;
    }

    private async sendRequestAsync<T extends cmd.Response>(req: cmd.Request<T>, waitResponse: boolean = true): Promise<cmd.Response | null> {
        const p = new Promise<cmd.Response>(async (resolve, reject) => {
            req.setId(this.getRequestId());
            this.responseEater = (buffer: Buffer) => {
                try {
                    const h: cmd.ResponseHeader = cmd.Response.parseHeader(this.buffer);
                    if (h.id === req.id) {
                        req.setResponse(req.createResponse(buffer));
                        return cmd.HeaderRespLen + h.bodyLength;
                    }
                } catch (err) {
                    console.error(`Error in responseEater(): ${err}`);
                    throw new Error(`Error occurred processing response for '${req.type}': ${err}`);
                }
                return 0;
            };

            this.echo('Request sent to VICEMON: ' + req.toString());
            await this.binarySocket.writeBinary(req.getBuffer());
            if (waitResponse) {
                const TIMEOUT_MS = 30000;
                let timeStart = performance.now();
                let triesStart = performance.now();
                while ((!req.tryGetResponse()) && (performance.now() - timeStart < TIMEOUT_MS)) {
                    await utils.delay(50);
                    // At interval print the message "waiting for response"
                    if (performance.now() - triesStart > 1000) {
                        this.echo(`Waiting for response of VICEMON for request: ${req.toString()}`);
                        triesStart = performance.now();
                    }
                }
                const resp: T = req.tryGetResponse();
                if (!resp) {
                    reject(new Error(`Timeout waiting for answer of ${req.toString()}`));
                } else {
                    this.echo(`Response from VICEMON: ${resp.toString()}`);
                    resolve(resp);
                }
            }
        });

        return await p.finally(() => this.responseEater = null);
    }

    private enqueue(promise: () => Promise<cmd.Response | null>): Promise<cmd.Response | null> {
        return new Promise<cmd.Response | null>((resolve, reject) => {
            this.queue.push({
                promise,
                resolve,
                reject,
            });
            this.dequeue();
        });
    }

    private dequeue(): boolean {
        if (this.workingOnPromise)
            return false;

        const item = this.queue.shift();
        if (!item)
            return false;

        try {
            this.workingOnPromise = true;
            item.promise()
                .then((value: cmd.Response | null) => {
                    this.workingOnPromise = false;
                    item.resolve(value);
                    this.dequeue();
                })
                .catch(err => {
                    this.workingOnPromise = false;
                    item.reject(err);
                    this.dequeue();
                });
        } catch (err) {
            this.workingOnPromise = false;
            item.reject(err);
            this.dequeue();
        }
        return true;
    }

    public isStopped(): boolean { return this.stopped; }
    
    public setStopped(stopped: boolean): void { this.stopped = stopped; }
    
    /**
     * Save the current running state before a binary protocol operation.
     * Call this before operations that might pause VICE.
     */
    public saveRunningState(): void {
        this.wasRunningBeforeOperation = !this.stopped;
    }
    
    /**
     * Restore the running state after a binary protocol operation.
     * If execution was running before, resume it.
     */
    public async restoreRunningState(): Promise<void> {
        if (this.wasRunningBeforeOperation && this.stopped) {
            await this.go();
        }
    }

    private handleIncomingData(b: Buffer): void {
        this.buffer = this.buffer ? Buffer.concat([this.buffer, b]) : b;

        let i = 0;
        const responseStartBytes: number = cmd.STX * 256 + cmd.APIVER;

        while (true) {
            if (!this.buffer)
                break;
            if (this.buffer.length < cmd.HeaderRespLen)
                break;

            // Eat until start of response.
            while (this.buffer.readUInt16LE(i) !== responseStartBytes) i += 1;
            if (i >= this.buffer.length) {
                // If header not found, discard all data.
                this.buffer = null;
                break;
            }
            // Eat discarded data before start of an header.
            this.buffer = this.buffer.slice(i);

            let h: cmd.ResponseHeader | null = null;
            try { h = cmd.Response.parseHeader(this.buffer); } 
            catch (err) {
                console.error(`Error parsing response header: ${err}`);
                this.emit('message', `Error parsing response header: ${err}`);
            }
            if (!h)
                return;
            else {
                let eaterResult: DataEaterResult | null = null;
                if (this.responseEater) {
                    const size = cmd.HeaderRespLen + h.bodyLength;
                    const buffer: Buffer = this.buffer.slice(0, size);
                    try {
                        eaterResult = this.responseEater(buffer);
                    } catch (err) {
                        console.error(`Error in responseEater(): ${err}`);
                        this.emit('message', `Error occurred processing response: ${err}`);
                    }
                    if (eaterResult) {
                        // Eat the consumed data: cmd.HeaderRespLen + h.bodyLength
                        this.buffer = this.buffer.slice(eaterResult);
                    }
                }

                if (!eaterResult) {
                    this.emit('output', `Received response: ${cmd.toString(h)} .`)

                    if (h.id !== 0xffffffff) {
                        console.error("unexpected response id");
                    }

                    //?? TODO
                    try {
                        const size = cmd.HeaderRespLen + h.bodyLength;
                        const buffer: Buffer = this.buffer.slice(0, size);
                        const stoppedResp = new cmd.StoppedResponse(buffer);
                        this.buffer = this.buffer.slice(size);
                        // Handle STOPPED events:
                        // - If expecting stopOnEntry AND program has resumed, this is the entry stop
                        // - Otherwise only process after initialization is complete
                        if (this.isInitializing && this.expectingStopOnEntry && this.hasResumedAfterCheckpoint) {
                            if (this.entryPointAddress !== undefined && stoppedResp.pc !== this.entryPointAddress) {
                                console.log(`Spurious stop at 0x${stoppedResp.pc.toString(16)} during initialization. Resuming...`);
                                this.go();
                                continue;
                            }
                            this.isInitializing = false;
                            this.expectingStopOnEntry = false;
                            this.hasResumedAfterCheckpoint = false;
                            this.stopped = true;
                            this.sendEvent('stop', 'entry', stoppedResp.pc);
                        } else if (!this.isInitializing) {
                            this.stopped = true;
                            this.sendEvent('stop', 'break', stoppedResp.pc);
                        } else {
                            // During initialization but not the entry stop - just update state
                            this.stopped = true;
                        }
                        continue;
                    }
                    catch {
                        //??
                    }

                    try {
                        const size = cmd.HeaderRespLen + h.bodyLength;
                        const buffer: Buffer = this.buffer.slice(0, size);
                        /*const resumedResp =*/ new cmd.ResumedResponse(buffer);
                        this.buffer = this.buffer.slice(size);
                        this.stopped = false;
                        // Track that program has resumed after checkpoint was set
                        if (this.expectingStopOnEntry) {
                            this.hasResumedAfterCheckpoint = true;
                        }
                        //this.emit('continue', resumedResp.pc);
                        continue;
                    }
                    catch {
                        //??
                    }

                    try {
                        const size = cmd.HeaderRespLen + h.bodyLength;
                        const buffer: Buffer = this.buffer.slice(0, size);
                        const resumedResp = new cmd.RegistersGetResponse(buffer);
                        this.buffer = this.buffer.slice(size);
                        this.updateRegisters(resumedResp);
                        this.sendEvent('registers', this.regs, this.regsInv);
                        continue;
                    }
                    catch {
                        //??
                    }

                    try {
                        const size = cmd.HeaderRespLen + h.bodyLength;
                        const buffer: Buffer = this.buffer.slice(0, size);
                        const resp = new cmd.CheckpointResponse(buffer);
                        this.buffer = this.buffer.slice(size);
                        this.stopped = resp.hit;
                        // If we hit a checkpoint during initialization, this is the stopOnEntry breakpoint
                        // Clear initialization flag and send the stop event
                        if (resp.hit) {
                            if (this.isInitializing) {
                                this.isInitializing = false;
                            }
                            this.sendEvent('stop', 'breakpoint');
                        }
                        continue;
                    }
                    catch {
                        //??
                    }

                    console.error(`discarding ${cmd.toString(h)}`);
                    this.buffer = this.buffer.slice(cmd.HeaderRespLen + h.bodyLength);
                }
            }
        }
    }

    private updateRegisters(resp: cmd.RegistersGetResponse): void {
        const r = this.regs;
        for (const id in r) {
            r[id].value = resp.regs[id].value;
        }
    }

    private async getVICEInfo(): Promise<void> {
        const infoReq = new cmd.VICEInfoGetRequest();
        const infoRes = await this.sendRequest<cmd.VICEInfoGetResponse>(infoReq);
        this.emit('output', `VICE version ${infoRes.info.version}, svn ${infoRes.info.svn}`);
    }

    public async getMemory(start: number, end: number, bankId: number = 0): Promise<Buffer> {
        this.saveRunningState();
        try {
            const memReq = new cmd.MemoryGetRequest(this.getRequestId(), start, end, bankId);
            const memRes = await this.sendRequest<cmd.MemoryGetResponse>(memReq);
            return memRes.memory;
        } finally {
            await this.restoreRunningState();
        }
    }

    public async setMemory(address: number, value: number, bankId: number = 0): Promise<void> {
        this.saveRunningState();
        try {
            const buffer = Buffer.alloc(1);
            buffer.writeUInt8(value, 0);
            const memReq = new cmd.MemorySetRequest(address, address, bankId, buffer);
            const resp = await this.sendRequest<cmd.MemorySetResponse>(memReq);
            
            if (resp.isError()) {
                throw new Error(`Failed to set memory at 0x${address.toString(16)}: ${resp.getErrorMessage()}`);
            }
        } finally {
            await this.restoreRunningState();
        }
    }

    public async setRegister(register: string, value: number): Promise<void> {
        this.saveRunningState();
        try {
            await this.fetchRegisters();
            if (!this.regsInv || !this.regsInv[register]) {
                throw new Error(`Unknown register: ${register}`);
            }
            const regId = this.regsInv[register].id;
            const setReq = new cmd.RegistersSetRequest(regId, value);
            const resp = await this.sendRequest<cmd.RegistersSetResponse>(setReq);
            
            if (resp.isError()) {
                throw new Error(`Failed to set register ${register}: ${resp.getErrorMessage()}`);
            }
        } finally {
            await this.restoreRunningState();
        }
    }

    private async fetchRegisters(): Promise<void> {
        if (!this.regs) {
            this.regs = {};
            this.regsInv = {};
            const avail = new cmd.RegistersAvailRequest();
            await this.sendRequest<cmd.RegistersAvailResponse>(avail);
            const m = avail.tryGetResponse().map;
            for (const id in m) {
                const regName = m[id].name;
                // Normalize status register name to always be "P"
                const normalizedName = isStatusRegister(regName) ? "P" : regName;

                this.regs[id] = {
                    name: normalizedName, byteCount: m[id].byteCount, value: 0
                };
                this.regsInv[normalizedName] = { id: parseInt(id) };
            }
        }

        const reg = new cmd.RegistersGetRequest();
        await this.sendRequest<cmd.RegistersGetResponse>(reg);
        const r = reg.tryGetResponse();
        this.updateRegisters(r);
    }

    public async waitConnectionDone(): Promise<void> {
        await this.socket.waitConnectionDone();
        await this.binarySocket.waitConnectionDone();

        this.connectionEstablished = true;

        await this.getVICEInfo();
        await this.fetchRegisters();
    }

    // map of breakpoints set in the VICE monitor.
    private breakpoints: Map<number, cmd.CheckpointResponse> = new Map<number, cmd.CheckpointResponse>();

    async setBreakpoint(pc: number): Promise<number> {
        this.saveRunningState();
        try {
            const cpr = new cmd.CheckpointSetRequest(pc, pc, true, true, cmd.CPUOp.EXEC, false);
            const cp = await this.sendRequest<cmd.CheckpointResponse>(cpr);
            
            if (cp.isError()) {
                throw new Error(`Failed to set breakpoint at 0x${pc.toString(16)}: ${cp.getErrorMessage()}`);
            }
            
            this.breakpoints.set(pc, cp);
            return cp.checkpointId;
        } finally {
            await this.restoreRunningState();
        }
    }

    async setCondition(checkpointId: number, condition: string): Promise<void> {
        this.saveRunningState();
        try {
            const req = new cmd.ConditionSetRequest(checkpointId, condition);
            const resp = await this.sendRequest<cmd.ConditionSetResponse>(req);
            
            if (resp.isError()) {
                throw new Error(`Failed to set condition "${condition}" on checkpoint ${checkpointId}: ${resp.getErrorMessage()}`);
            }
        } finally {
            await this.restoreRunningState();
        }
    }

    async delBreakpoints(): Promise<void> {
        this.saveRunningState();
        try {
            const req = new cmd.CheckpointListRequest();
            function dataEater(buffer: Buffer): number {
                try {
                    const header: cmd.ResponseHeader = cmd.Response.parseHeader(buffer);
                    console.log(`Parsed header: ${header.toString()}`);
                    
                    // Only consume checkpoint-related responses for this request
                    if (header.id === req.id) {
                        // Check if this is a checkpoint info (0x22) or checkpoint list (0x14) response
                        if (header.type === cmd.ResponseType.MON_RESPONSE_CHECKPOINT_INFO || 
                            header.type === cmd.ResponseType.MON_RESPONSE_CHECKPOINT_LIST) {
                            req.addData(buffer);
                            return cmd.HeaderRespLen + header.bodyLength;
                        }
                    }
                } catch (err) {
                    console.error(`Error in responseEater(): ${err}`);
                }
                return 0;
            }

            // First get the list of breakpoints.
            const existingBreakpoints = await this.sendRequestCustom<cmd.CheckpointListFakeResponse>(req, dataEater);

            await utils.delay(500);
            for (const [pc, cp] of this.breakpoints.entries()) {
                try {
                    // Skip not existing checkpoints.
                    const found = existingBreakpoints.checkpointIds.includes(cp.checkpointId);
                    if (!found) {
                        //?? TODO breakpoint not found in VICE, maybe already deleted?
                        this.emit('output', `Warning: skipping deletion of a breakpoint at ${pc.toString(16)} not found in VICE.`);
                        continue;
                    }
                    const cdr = new cmd.CheckpointDeleteRequest(cp.checkpointId);
                    //?? Delete the breakpoint before the request, HACK
                    this.breakpoints.delete(pc);
                    await this.sendRequest<cmd.CheckpointDeleteResponse>(cdr);
                } catch (err) {
                    const bpId = cp?.checkpointId ?? -1;
                    this.emit('output', `Error deleting breakpoint ${bpId}: ${err}`);
                }
            }
        } finally {
            await this.restoreRunningState();
        }
    }

    async go(pc?: number): Promise<void> {
        this.stopped = false;
        this.sendEvent('continue');
        const avail = new cmd.ContinueRequest();
        await this.sendRequest<cmd.ContinueResponse>(avail);
    }

    public async next(): Promise<void> {
        const next = new cmd.StepOverRequest();
        await this.sendRequest<cmd.StepOverResponse>(next);
    }

    public async step(): Promise<void> {
        const step = new cmd.StepInRequest();
        await this.sendRequest<cmd.StepInResponse>(step);
    }

    async pause(): Promise<void> {
        const regs = new cmd.RegistersGetRequest();
        await this.sendRequest<cmd.RegistersGetResponse>(regs);
        this.emit('stop', 'user');
    }

    async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;

            // Abort the controller to signal sockets to stop
            this.abortController.abort();

            try {
                const quit = new cmd.QuitRequest();
                await this.sendRequest<cmd.QuitResponse>(quit);
            } catch {
                //?? TODO ignore all errors.
            }

            this.socket.dispose();
            this.binarySocket.dispose();
            this.emit('quit');
        }
    }

    async disasm(pc?: number): Promise<void> {
        //??const cmd = pc === undefined ? 'disass' : `disass ${pc.toString(16)}`;
        //??await this.socket.sendRequest(Buffer.from(cmd));
    }

    async textCommand(cmd: string): Promise<void> {
        Promise.resolve(this.socket.writeBinary(Buffer.from(cmd)));
    }

    async loadProgram(prgName: string, startAddress: number, stopOnEntry: boolean): Promise<void> {
        this.entryPointAddress = stopOnEntry ? startAddress : undefined;
        if (stopOnEntry) {
            const set = new cmd.CheckpointSetRequest(
                startAddress, startAddress, true, true,
                cmd.CPUOp.EXEC, true);
            const setResp = await this.sendRequest<cmd.AutoStartResponse>(set);
            if (setResp.isError()) {
                throw new Error(`Failed to set entry checkpoint at 0x${startAddress.toString(16)}: ${setResp.getErrorMessage()}`);
            }
            
            // Mark that we're expecting a stopOnEntry event
            this.expectingStopOnEntry = true;
        }

        const start = new cmd.AutoStartRequest(prgName, true);
        const startResp = await this.sendRequest<cmd.AutoStartResponse>(start);
        if (startResp.isError()) {
            throw new Error(`Failed to autostart program "${prgName}": ${startResp.getErrorMessage()}`);
        }
        
        // If not stopping on entry, initialization is complete
        // Otherwise, isInitializing will be cleared when the checkpoint is hit
        if (!stopOnEntry) {
            this.isInitializing = false;
            this.stopped = false;
        }
    }

    private sendEvent(event: string, ...args: any[]) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }

};

type C64jasmDebugInfo = {
    outputPrg: string;
    symbols?: { name: string, addr: number, size: number, segmentName: string, source: string, line: number }[];
    variables?: { name: string, value: any }[];
    debugInfo: {
        pcToLocs: {
            [pc: string]: {
                lineNo: number, source: string
            }[];
        }
    }
};

let c64jasmServerProcessId: number | null = null;
let c64jasmServerArgs: { sourceFile: string, outputPath: string } | null = null;
let abortServerStartup: (() => void) | null = null;
let viceProcessId: number | null = null;

function startC64jasmServer(
    sourceFile: string,
    prgPath: string,
    disasmPath: string | undefined,
    emitRunInTerminal: (args: any, timeout: number, callback: (response: any) => void) => void,
    isDevelopmentMode: boolean = false
): Promise<void> {
    return new Promise((resolve, reject) => {
        let aborted = false;

        // Set up abort handler
        abortServerStartup = () => {
            aborted = true;
            reject(new Error('Server startup cancelled by user'));
        };

        // Check if server is already running with the same arguments
        if (c64jasmServerProcessId && c64jasmServerArgs) {
            if (c64jasmServerArgs.sourceFile === sourceFile && c64jasmServerArgs.outputPath === prgPath) {
                console.log(`c64jasm server already running with same arguments (pid=${c64jasmServerProcessId})`);
                abortServerStartup = null;
                resolve();
                return;
            }
            // Different arguments, stop the old server
            console.log(`Stopping previous c64jasm server (pid=${c64jasmServerProcessId}) - different arguments`);
            if (c64jasmServerProcessId > 0) {
                try {
                    process.kill(c64jasmServerProcessId, 'SIGTERM');
                } catch (err) {
                    console.error(`Failed to kill previous server: ${err}`);
                }
            }
            c64jasmServerProcessId = null;
            c64jasmServerArgs = null;
        }

        try {
            const finalDisasmPath = disasmPath || prgPath.replace(/\.prg$/, '.disasm');
            const sourceDir = path.dirname(sourceFile);
            const args = isDevelopmentMode
                ? [
                    'node',
                    // When in development mode, compute path to kick project's cli.js
                    // __dirname when compiled is in client/out, so go up to vscode root, then up to kick root
                    path.join(__dirname, '..', '..', '..', 'build', 'src', 'cli.js'),
                    '--watch', sourceDir,
                    '--out', prgPath,
                    '--server', sourceFile,
                    '--disasm', finalDisasmPath
                ]
                : [
                    'c64jasm',
                    '--watch', sourceDir,
                    '--out', prgPath,
                    '--server', sourceFile,
                    '--disasm', finalDisasmPath
                ];

            // Launch c64jasm in integrated terminal using runInTerminal
            emitRunInTerminal({
                args,
                title: 'c64jasm debug srv',
                kind: 'integrated'
            }, 10000, (response: any) => {
                if (!response.success) {
                    abortServerStartup = null;
                    reject(new Error(`Failed to start c64jasm server: ${response.message || 'unknown error'}`));
                    return;
                }
                // Store the process ID so we can kill it later
                c64jasmServerProcessId = response.body?.processId || null;
                if (!c64jasmServerProcessId) {
                    console.warn('Warning: runInTerminal did not return a processId for c64jasm server');
                }
                c64jasmServerArgs = { sourceFile, outputPath: prgPath };
                console.log(`c64jasm server started with pid=${c64jasmServerProcessId || 'unknown'}`);
            });

            // Poll the server to check if it's ready
            const TIMEOUT_MS = 60000; // 1 minute
            const POLL_INTERVAL_MS = 1000; // 1 second
            const startTime = performance.now();

            const pollServer = async () => {
                while (performance.now() - startTime < TIMEOUT_MS) {
                    // Check if user cancelled
                    if (aborted) {
                        return;
                    }

                    // Try to connect to the server and get debug info
                    try {
                        await queryC64jasmDebugInfo(sourceFile, prgPath, disasmPath, false);
                        console.log('c64jasm server is ready');
                        abortServerStartup = null;
                        resolve();
                        return;
                    } catch {
                        // Server not ready yet, continue polling
                    }

                    // Wait before next poll
                    await utils.delay(POLL_INTERVAL_MS);
                }

                // Timeout reached
                abortServerStartup = null;
                reject(new Error('Timeout waiting for c64jasm server to start (60s)'));
            };

            pollServer();
        } catch (err) {
            reject(err);
        }
    });
}

function stopC64jasmServer(): void {
    // If server is still starting up, abort it
    if (abortServerStartup) {
        abortServerStartup();
        abortServerStartup = null;
    }

    // Kill the running server process
    if (c64jasmServerProcessId && c64jasmServerProcessId > 0) {
        try {
            console.log(`Stopping c64jasm server (pid=${c64jasmServerProcessId})`);
            process.kill(c64jasmServerProcessId, 'SIGTERM');
        } catch (err) {
            console.error(`Failed to stop c64jasm server: ${err}`);
        }
        c64jasmServerProcessId = null;
        c64jasmServerArgs = null;
    }
}

function queryC64jasmDebugInfo(
    sourceFile: string,
    outputPath: string,
    disasmPath: string | undefined,
    autoStart: boolean = true,
    emitRunInTerminal?: (args: any, timeout: number, callback: (response: any) => void) => void,
    isDevelopmentMode: boolean = false
): Promise<C64jasmDebugInfo> {
    const errMsg: string = `Cannot connect to c64jasm server. Please start it with 'c64jasm --server --watch' to build the sources.`;

    const attemptConnection = (host: string): Promise<C64jasmDebugInfo> => {
        return new Promise((resolve, reject) => {
            try {
                const port = 6502;

                const client = net.createConnection({
                    port, host,
                    timeout: 5000
                }, () => {
                    client.write('debug-info\r\n');
                });

                const chunks: Buffer[] = [];
                client.on('data', data => {
                    chunks.push(data);
                }).on('end', () => {
                    resolve(JSON.parse(Buffer.concat(chunks).toString()));
                }).on("error", err => {
                    return reject(`${errMsg}\n Error:'${err}'.`);
                });
            } catch (err) {
                return reject(`${errMsg} '${err}'.`);
            }
        });
    };

    const performConnection = async (): Promise<C64jasmDebugInfo> => {
        try {
            return await attemptConnection("127.0.0.1");
        } catch (e) {
            return await attemptConnection("::1");
        }
    };

    return performConnection().catch(async (err) => {
        if (autoStart && emitRunInTerminal) {
            // Try to start the server and retry
            try {
                await startC64jasmServer(sourceFile, outputPath, disasmPath, emitRunInTerminal, isDevelopmentMode);
                // Retry connection after starting server
                return await performConnection();
            } catch (startErr) {
                throw new Error(`${err}\n\nAlso failed to automatically start server: ${startErr}`);
            }
        }
        throw new Error(err);
    });
};

// This is a super expensive function but at least for now,
// it's only ever run when setting a breakpoint from the UI.
function findSourceLoc(c64jasm: C64jasmDebugInfo | null, sourcePath: string, line: number): number | null {
    if (c64jasm && c64jasm.debugInfo) {
        const pclocs = c64jasm.debugInfo.pcToLocs;
        const normalizedPath = path.resolve(sourcePath);
        
        for (const pc of Object.keys(pclocs)) {
            const locList = pclocs[pc];
            for (let i = 0; i < locList.length; i++) {
                const loc = locList[i];
                // Use path.resolve for robust comparison
                if (path.resolve(loc.source) === normalizedPath && loc.lineNo === line) {
                    return parseInt(pc, 10);
                }
            }
        }
    }
    return null;
}

// Parse .prg BASIC start header.  This matches with what c64jasm
// authored prgs output.  We use this for setting an initial breakpoint
// for the program entry point.
function parseBasicSysAddress(progName: string): number {
    const buf = fs.readFileSync(progName);
    //    00000000: 0108 xxxx yyyy 9e32 3036 3100 0000 a900  .......2061.....

    if (buf[0] == 0x01 && buf[1] == 0x08 && buf[6] == 0x9e) {
        let offs = 7;
        let addr = 0;
        while (buf[offs] != 0) {
            addr *= 10;
            addr += buf[offs] - 0x30;
            offs++;
        }
        return addr;
    }
    throw new Error('couldn\'t parse entry point address');
}

/**
 * A C64jasm runtime with minimal debugger functionality.
 * This class is a singleton to ensure only one VICE instance and c64jasm server run at a time.
 */
export class C64jasmRuntime extends EventEmitter {
    static readonly defaultMonitorPort: number = 29321;
    static readonly defaultBinaryPort: number = 29745;

    private static instance: C64jasmRuntime | null = null;

    // maps from sourceFile to array of C64jasm breakpoints
    private _breakpoints = new Map<string, C64jasmBreakpoint[]>();

    // since we want to send breakpoint events, we will assign an id to every event
    // so that the frontend can match events with breakpoints.
    private _breakpointId = 1;

    private monitor: MonitorConnection | undefined = undefined;
    private _debugInfo: C64jasmDebugInfo | null = null;
    private _disasmPath: string | undefined = undefined;
    private abortController: AbortController | undefined = undefined;

    private regs: C64Regs | null = null;
    private regsInv: C64RegsInv | null = null

    // Call stack tracking for robust debugging
    private callStack: Array<{ address: number, functionName: string, returnAddress: number }> = [];

    private readonly debugConsoleOutput = (logMsg: string) => {
        this.sendEvent('output', logMsg);
    };

    private constructor() {
        super();
    }

    /**
     * Get the singleton instance of C64jasmRuntime.
     * Creates the instance if it doesn't exist.
     */
    public static getInstance(): C64jasmRuntime {
        if (!C64jasmRuntime.instance) {
            C64jasmRuntime.instance = new C64jasmRuntime();
        }
        return C64jasmRuntime.instance;
    }

    /**
     * Reset the singleton instance.
     * Should only be called during cleanup or testing.
     */
    public static resetInstance(): void {
        C64jasmRuntime.instance = null;
    }

    public breakpoints(path: string): C64jasmBreakpoint[] {
        const breakpointsForPath = this._breakpoints.get(path);
        return breakpointsForPath ? breakpointsForPath.slice() : [];
    }

    public getAllBreakpoints(): C64jasmBreakpoint[] {
        let all: C64jasmBreakpoint[] = [];
        for (const bps of this._breakpoints.values()) {
            // return a copy of the array using slice().
            all = all.concat(bps.slice());
        }
        return all;
    }
    private async getPort(host: string, start: number, end: number): Promise<number> {
        return await getport({
            port: getport.makeRange(start + Math.floor(Math.random() * 256.), end),
            host: host
        });
    }

    /**
     * Start executing the given program.
     */
    public async start(program: string, stopOnEntry: boolean, vicePath: string, sourceFile: string, disasmPath: string | undefined, extensionMode?: vscode.ExtensionMode): Promise<void> {
        const startAddress = parseBasicSysAddress(program);
        const host = "127.0.0.1";

        this._disasmPath = disasmPath ?? program.replace(/\.prg$/, '.disasm');

        // Determine if we're in development mode
        const isDevelopmentMode = extensionMode === vscode.ExtensionMode.Development;

        // Ask c64jasm compiler for debug information.  This is done
        // by connecting to a running c64jasm process that's watching
        // source files for changes.
        this._debugInfo = await queryC64jasmDebugInfo(
            sourceFile,
            program,
            this._disasmPath,
            true,
            (args, timeout, callback) => this.emit('runInTerminal', args, timeout, callback),
            isDevelopmentMode
        );

        // Debug: Log which source files are in the debug info
        if (this._debugInfo && this._debugInfo.debugInfo && this._debugInfo.debugInfo.pcToLocs) {
            const sourceFiles = new Set<string>();
            const pclocs = this._debugInfo.debugInfo.pcToLocs;
            for (const pc of Object.keys(pclocs)) {
                const locList = pclocs[pc];
                for (const loc of locList) {
                    sourceFiles.add(loc.source);
                }
            }
            console.log('Debug info contains source files:', Array.from(sourceFiles));
            console.log('Total symbols:', this._debugInfo.symbols?.length || 0);
            console.log('Total variables:', this._debugInfo.variables?.length || 0);
        }

        const monitorPort = await this.getPort(host, C64jasmRuntime.defaultMonitorPort,
            C64jasmRuntime.defaultMonitorPort + 1024);
        const binaryPort = await this.getPort(host, C64jasmRuntime.defaultBinaryPort,
            C64jasmRuntime.defaultBinaryPort + 1024);

        // Abort any pending connection attempts
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }

        // Dispose old monitor connection if it exists
        if (this.monitor) {
            await this.monitor.dispose();
            this.monitor = undefined;
        }

        // Create abort controller for connection attempts
        this.abortController = new AbortController();
        this.monitor = new MonitorConnection(this.debugConsoleOutput, monitorPort, binaryPort, this.abortController);

        // Handle stop on breakpoint and other events from VICE.
        this.monitor.on('output', (msg) => {
            this.sendEvent('output', msg);
        });
        this.monitor.on('stop', async (reason) => {
            this.sendEvent('stop', reason);
            // Fetch memory when stopped (256 bytes starting from $0000)
            try {
                const memory = await this.monitor.getMemory(0x0000, 0x00FF, 0);
                this.sendEvent('memory', memory.toString('hex'));
            } catch (err) {
                console.error(`Failed to fetch memory: ${err}`);
            }
        });
        this.monitor.on('continue', () => {
            this.sendEvent('continue');
        });
        this.monitor.on('message', (msg) => {
            this.sendEvent('message', msg);
        });
        this.monitor.on('registers', (regs, regsInv) => {
            this.updateRegisters(regs, regsInv);
            //??
            this.sendEvent('registers', regs, regsInv);
        });
        this.monitor.on('quit', () => {
            this.sendEvent('end');
        });

        if (!fs.existsSync(program))
            throw new Error(`The file to debug '${program}' does not exist`);
        if (!fs.existsSync(vicePath))
            throw new Error(`VICE executable 'x64sc' does not exist at '${vicePath}'`);

        // Stop previous VICE instance if running
        if (viceProcessId && viceProcessId > 0) {
            console.log(`Stopping previous x64sc instance (pid=${viceProcessId})`);
            try {
                process.kill(viceProcessId, 'SIGTERM');
            } catch (err) {
                console.error(`Failed to kill previous VICE instance: ${err}`);
            }
            viceProcessId = null;
        }

        const vsFile: string = await this.createCommandsFile(program, startAddress);
        const logFile = utils.toDotC64jasmDir(program, '.log');

        const args = [
            '-logfile', logFile,
            '-moncommands', vsFile,
            "-autostart-warp",
            "-autostartprgmode", "1",
            "+autostart-handle-tde",
            "-remotemonitor", "-remotemonitoraddress", `${host}:${monitorPort}`,
            "-binarymonitor", "-binarymonitoraddress", `${host}:${binaryPort}`
        ];

        const [vicePid, shellPid] = await new Promise<[number, number]>((resolve, reject) => {
            this.emit('runInTerminal', {
                args: [vicePath, ...args],
                //??cwd: opts.cwd || __basedir,
                //??env: Object.assign({}, <any>opts.env || {}, { ELECTRON_RUN_AS_NODE: "1" }),
                title: `x64sc localhost:${monitorPort}`,
                kind: 'integrated'
            }, 10000, (response: any) => {
                if (!response.success) {
                    reject(response);
                } else {
                    const pid = response.body?.processId || null;
                    const shellPid = response.body?.shellProcessId || null;
                    if (!pid) {
                        console.warn('Warning: runInTerminal did not return a processId for x64sc');
                    }
                    resolve([pid, shellPid]);
                }
            })
        });
        viceProcessId = vicePid;
        this.emit('output', `Launched [x64sc, pid=${vicePid || 'unknown'}] and [shell, pid=${shellPid || 'unknown'}]`);

        // Wait for VICE to open its monitor and binary protocol ports
        try {
            this.emit('output', `Waiting for VICE monitor port ${monitorPort} to become available...`);
            await utils.waitForPort(host, monitorPort, 30000, 1000);
            this.emit('output', `Waiting for VICE binary port ${binaryPort} to become available...`);
            await utils.waitForPort(host, binaryPort, 30000, 1000);
            this.emit('output', 'VICE ports are ready, connecting...');

            await this.monitor.waitConnectionDone();
            
            // Initialize call stack trackers
            this.callStack = [];
            
            await this.monitor.loadProgram(program, startAddress, stopOnEntry);

            // Verify and set all breakpoints that were registered before VICE started
            for (const [path, _] of this._breakpoints.entries()) {
                await this.verifyBreakpoints(path);
            }

            this.emit('started');
        } catch (err) {
            // Clean up on connection failure
            if (this.monitor) {
                await this.monitor.dispose();
                this.monitor = undefined;
            }
            throw err;
        }
    }

    public async terminate(): Promise<void> {
        // Abort any pending connection attempts
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }

        const monitorToDispose = this.monitor;
        this.monitor = undefined;
        
        const vicePidToKill = viceProcessId;
        viceProcessId = null;

        stopC64jasmServer();

        if (monitorToDispose) {
            await monitorToDispose.dispose();
        }

        // Stop VICE emulator
        if (vicePidToKill && vicePidToKill > 0) {
            try {
                console.log(`Stopping x64sc (pid=${vicePidToKill})`);
                process.kill(vicePidToKill, 'SIGTERM');
            } catch (err) {
                console.error(`Failed to stop VICE: ${err}`);
            }
        }
    }

    /**
     * Continue execution.
     */
    public continue(): Promise<void> {
        return this.monitor?.go() ?? Promise.resolve();
    }
    
    /**
     * Check if the runtime is currently running (not stopped).
     */
    public async isRunning(): Promise<boolean> {
        return !(this.monitor?.isStopped() ?? true);
    }

    public step(): Promise<void> {
        return this.monitor?.step() ?? Promise.resolve();
    }

    public next(): Promise<void> {
        return this.monitor?.next() ?? Promise.resolve();
    }

    public pause(): Promise<void> {
        return this.monitor?.pause() ?? Promise.resolve();
    }

    private async createCommandsFile(program: string, startAddress: number): Promise<string> {
        const vsFile: string | undefined = utils.toDotC64jasmDir(program, '.vs');
        if (!vsFile) {
            throw new Error("Cannot compute command file path.")
        }
        await mkdir(path.dirname(vsFile), { recursive: true });
        await fs.promises.writeFile(vsFile,
            ""
            //`warp on${ os.EOL }`
            //l ${program} 0 801${os.EOL}break ${startAddress}${os.EOL}goto ${startAddress}${os.EOL}del`
        );
        return vsFile;
    }

    private findSourceLineByAddr(addr: number) {
        // Use lookup map if available
        if (this._debugInfo?.debugInfo.pcToLocs) {
            const locs = this._debugInfo.debugInfo.pcToLocs[addr];
            if (locs && locs.length > 0) {
                const info = locs[0];
                // Resolve the path to ensure consistency
                const resolvedPath = path.resolve(info.source);
                return {
                    src: new Source(path.basename(resolvedPath), resolvedPath),
                    line: info.lineNo
                };
            }
        }
        
        // Fallback or explicit check failed
        // this.debugConsoleOutput(`Cannot find location of address '${addr}'.`);
        return undefined;
    }

    private updateRegisters(r: C64Regs, rInv: C64RegsInv) {
        this.regs = r;
        this.regsInv = rInv
    }

    /**
     * Returns a stack trace for the address where we're currently stopped at.
     * Returns an array of stack frames representing the call stack.
     */
    public async stackTrace(): Promise<StackFrame[]> {
        const frames: StackFrame[] = [];

        // Update call stack from return addresses
        await this.updateCallStack();

        if (!this._debugInfo || !this._debugInfo.debugInfo || !this.regs || !this.regsInv) {
            return frames;
        }

        const pcRegId = this.regsInv['PC']?.id;
        if (pcRegId === undefined) {
            return frames;
        }

        const currentPC = this.regs[pcRegId]?.value;
        if (currentPC === undefined) {
            return frames;
        }

        console.log(`DEBUG: stackTrace() - Current PC: 0x${currentPC.toString(16).toUpperCase()}, callStack.length: ${this.callStack.length}`);

        // Debug: show code ranges
        if (this._debugInfo && this._debugInfo.symbols) {
            const codeRanges = this._debugInfo.symbols.map(s => `${s.name}:0x${s.addr.toString(16).toUpperCase()}-0x${(s.addr + s.size).toString(16).toUpperCase()}`).join(', ');
            console.log(`DEBUG: stackTrace() - Available symbols: ${codeRanges}`);
        }

        // Add the current frame (frame 0)
        const res = this.findSourceLineByAddr(currentPC);
        const currentFuncName = this.getFunctionNameForAddress(currentPC);
        const frame0 = new StackFrame(0, currentFuncName, res ? res.src : undefined, res ? res.line : 0);
        const instrAddr0 = this.findInstructionStartAddress(currentPC);
        frame0.instructionPointerReference = `0x${instrAddr0.toString(16).toUpperCase()}`;
        frames.push(frame0);

        // Add frames from the call stack
        let frameIndex = 1;
        for (const stackFrame of this.callStack) {
            let frameName = stackFrame.functionName;
            const res = this.findSourceLineByAddr(stackFrame.returnAddress);
            
            const frame = new StackFrame(frameIndex, frameName, res ? res.src : undefined, res ? res.line : 0);
            const instrAddr = this.findInstructionStartAddress(stackFrame.returnAddress);
            frame.instructionPointerReference = `0x${instrAddr.toString(16).toUpperCase()}`;
            frames.push(frame);
            frameIndex++;
        }

        console.log(`DEBUG: stackTrace() - Returning ${frames.length} frames`);
        return frames;
    }

    /**
     * Legacy method: Returns a single stack frame (for backwards compatibility).
     * Use stackTrace() for getting the full call stack.
     */
    public stack(): StackFrame | undefined {
        if (this._debugInfo && this._debugInfo.debugInfo && this.regs && this.regsInv) {
            const address = this.regs[this.regsInv['PC'].id].value;
            const res = this.findSourceLineByAddr(address);
            if (res) {
                const { src, line } = res;
                const frame = new StackFrame(1, src.name, src, line);
                // Set instruction pointer reference for disassembly view
                // Find the actual instruction start address from the disasm file
                const instrAddr = this.findInstructionStartAddress(address);
                frame.instructionPointerReference = `0x${instrAddr.toString(16).toUpperCase()}`;
                return frame;
            }
        }
        return undefined;
    }

    /**
     * Find the start address of the instruction that contains the given address.
     * This is needed because the PC might point to the middle of a multi-byte instruction.
     * Uses the pcToLocs mapping which contains all instruction start addresses.
     * Returns the instruction with the closest address by absolute distance.
     */
    private findInstructionStartAddress(targetAddr: number): number {
        if (!this._debugInfo?.debugInfo?.pcToLocs) {
            return targetAddr;
        }

        const pclocs = this._debugInfo.debugInfo.pcToLocs;
        const addresses = Object.keys(pclocs).map(addr => parseInt(addr));
        
        if (addresses.length === 0) {
            return targetAddr;
        }
        
        // Find the closest address that is <= targetAddr
        let bestAddr = -1;
        let minDistance = Infinity;
        
        for (const addr of addresses) {
            if (addr <= targetAddr) {
                const distance = targetAddr - addr;
                if (distance < minDistance) {
                    minDistance = distance;
                    bestAddr = addr;
                }
            }
        }
        
        return bestAddr !== -1 ? bestAddr : targetAddr;
    }

    /*
     * Set breakpoint in file at the given line.
     */
    public async setBreakpoint(path: string, line: number, condition?: string): Promise<C64jasmBreakpoint> {
        const bp: C64jasmBreakpoint = { verified: false, line, id: this._breakpointId++, condition };
        let bps = this._breakpoints.get(path) ?? new Array<C64jasmBreakpoint>();
        this._breakpoints.set(path, bps);
        bps.push(bp);
        return bp;
    }

    /*
     * Clear all breakpoints for file.
     */
    public async clearBreakpoints(path: string) {
        // Always clear the local breakpoint list
        this._breakpoints.delete(path);
        
        // Only delete breakpoints in VICE if monitor is connected
        if (this.monitor) {
            await this.monitor.delBreakpoints();
        }
    }

    /**
     * Set a condition on a checkpoint (breakpoint).
     * @param checkpointId The checkpoint ID returned when the breakpoint was set
     * @param condition The condition expression (e.g., "A == $10")
     */
    public async setBreakpointCondition(checkpointId: number, condition: string): Promise<void> {
        if (this.monitor) {
            await this.monitor.setCondition(checkpointId, condition);
        }
    }

    // Disassemble from current PC
    public disasm(pc?: number): Promise<void> {
        if (this.monitor)
            return this.monitor.disasm(pc);
        else
            return Promise.resolve();
    }

    public lookupSymbol(name: string): { name: string, addr?: number, size?: number, value?: any, segmentName?: string } | null {
        if (!this._debugInfo) {
            console.log(`[lookupSymbol] No debug info available`);
            return null;
        }
        
        const nameToFind = name.toLowerCase();
        
        // Helper function to find symbol by exact match or FQN suffix
        const findByName = <T extends { name: string }>(items: T[] | undefined): T | undefined => {
            if (!items) return undefined;
            
            // Try exact match first
            let match = items.find(s => s.name.toLowerCase() === nameToFind);
            if (match) return match;
            
            // Try FQN suffix match (e.g., "myvar" matches "scope::myvar")
            const suffixMatches = items.filter(s => {
                const lowerName = s.name.toLowerCase();
                return lowerName.endsWith('::' + nameToFind) || lowerName.endsWith('.' + nameToFind);
            });
            
            if (suffixMatches.length > 0) {
                // Prefer shortest match (closest scope)
                match = suffixMatches.reduce((shortest, current) => 
                    current.name.length < shortest.name.length ? current : shortest
                );
            }
            
            return match;
        };
        
        // First check symbols (have address and size)
        const symbol = findByName(this._debugInfo.symbols);
        if (symbol) {
            console.log(`[lookupSymbol] Found symbol: ${name} -> ${symbol.name} addr=$${symbol.addr?.toString(16)}, size=${symbol.size}`);
            return symbol;
        }
        
        // Then check variables (have value but no address)
        const variable = findByName(this._debugInfo.variables);
        if (variable) {
            console.log(`[lookupSymbol] Found variable: ${name} -> ${variable.name} value=${JSON.stringify(variable.value)}`);
            return { name: variable.name, value: variable.value };
        }
        
        console.log(`[lookupSymbol] Symbol not found: ${name} (searched ${this._debugInfo.symbols?.length || 0} symbols, ${this._debugInfo.variables?.length || 0} variables)`);
        return null;
    }

    public async textCommand(c: string): Promise<string> {
        // Try to resolve symbol names from debug info first
        const trimmedCmd = c.trim();
        const symbol = this.lookupSymbol(trimmedCmd);
        if (symbol) {
            return `$${symbol.addr.toString(16).toUpperCase()}`;
        }

        // Fall back to VICE monitor command (currently not captured)
        this.monitor.textCommand(c);
        return Promise.resolve<string>("");
    }

    public async retrieveRegisters(): Promise<C64Regs | null> {
        return Promise.resolve(this.regs);
    }

    public async retrieveRegistersWithInv(): Promise<{ regs: C64Regs | null, regsInv: C64RegsInv | null }> {
        return Promise.resolve({ regs: this.regs, regsInv: this.regsInv });
    }

    public async retrieveMemory(start: number, end: number, bankId: number = 0): Promise<string> {
        if (this.monitor) {
            const memory = await this.monitor.getMemory(start, end, bankId);
            return memory.toString('hex');
        }
        return '';
    }

    public async writeMemory(address: number, value: number, bankId: number = 0): Promise<void> {
        if (this.monitor) {
            await this.monitor.setMemory(address, value, bankId);
        }
    }

    public async writeRegister(register: string, value: number): Promise<void> {
        if (this.monitor) {
            await this.monitor.setRegister(register, value);
        }
    }

    public async verifyBreakpoints(path: string) {
        if (this.monitor) {
            let bps = this._breakpoints.get(path);
            if (bps) {
                // Save running state before setting breakpoints
                const wasRunning = await this.isRunning();
                
                for (const bp of bps) {
                    if (!bp.verified) {
                        const addr = findSourceLoc(this._debugInfo, path, bp.line);

                        if (addr) {
                            bp.verified = true;
                            const checkpointId = await this.monitor.setBreakpoint(addr);
                            bp.checkpointId = checkpointId;
                            
                            // Set condition if present
                            if (bp.condition) {
                                await this.monitor.setCondition(checkpointId, bp.condition);
                            }
                            
                            this.sendEvent('breakpointValidated', bp);
                        } else {
                            this.debugConsoleOutput(`Cannot find ${bp}`);
                        }
                    }
                }
                
                // Restore running state after setting breakpoints
                if (wasRunning && this.monitor.isStopped()) {
                    await this.monitor.go();
                }
            }
        }
    }

    public async disassemble(memoryReference: string, instructionCount: number, offset: number): Promise<any[]> {
        // Parse memory reference (could be address or expression)
        let targetAddress: number;
        if (memoryReference.startsWith('0x')) {
            targetAddress = parseInt(memoryReference.substring(2), 16);
        } else {
            targetAddress = parseInt(memoryReference, 10);
        }

        const instructions: any[] = [];

        // Read the .disasm file if available
        const disasmFile = this._disasmPath;
        if (disasmFile && fs.existsSync(disasmFile)) {
            const disasmContent = fs.readFileSync(disasmFile, 'utf-8');
            const lines = disasmContent.split('\n');

            // First pass: collect all instructions with their addresses and byte counts
            const allInstructions: Array<{addr: number, line: string, byteCount: number}> = [];
            for (const line of lines) {
                const match = line.match(/^([0-9A-Fa-f]{1,4}):\s+([0-9A-Fa-f\s…]+?)(?:\s{2,}(\S.*))?$/);
                if (match) {
                    const addr = parseInt(match[1], 16);
                    // Count bytes in the hex portion (excluding ellipsis)
                    const bytesStr = match[2].replace(/…/g, '').trim().split(/\s+/).filter(b => b);
                    const byteCount = bytesStr.length;
                    allInstructions.push({addr, line, byteCount});
                }
            }

            // Find the instruction that contains the target address
            // An instruction contains targetAddress if: addr <= targetAddress < addr + byteCount
            let targetIndex = 0;
            for (let i = 0; i < allInstructions.length; i++) {
                const instr = allInstructions[i];
                // Check if targetAddress falls within this instruction's byte range
                if (instr.addr <= targetAddress && targetAddress < instr.addr + instr.byteCount) {
                    targetIndex = i;
                    break;
                }
                // Also keep track of the last instruction before target (fallback)
                if (instr.addr <= targetAddress) {
                    targetIndex = i;
                }
            }

            // Apply instruction offset (offset is in number of instructions, not bytes)
            let startIndex = targetIndex + offset;
            startIndex = Math.max(0, Math.min(startIndex, allInstructions.length - 1));

            // Collect the requested number of instructions starting from startIndex
            for (let i = startIndex; i < allInstructions.length && instructions.length < instructionCount; i++) {
                const line = allInstructions[i].line;
                const match = line.match(/^([0-9A-Fa-f]{1,4}):\s+([0-9A-Fa-f\s…]+?)(?:\s{2,}(\S.*))?$/);
                if (match) {
                    const addr = parseInt(match[1], 16);
                    const bytesStr = match[2].replace(/…/g, '').trim().split(/\s+/).filter(b => b);
                    const instruction = match[3] ? match[3].trim() : bytesStr.join(' ');

                    // Look up source location
                    const location = this.findSourceLineByAddr(addr);

                    instructions.push({
                        address: `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`,
                        instruction: instruction,
                        instructionBytes: bytesStr.join(' '),
                        ...(location && {
                            location: location.src,
                            line: location.line
                        })
                    });
                }
            }
        }

        return instructions;
    }

    public getLoadedSources(): Source[] {
        const sources: Source[] = [];
        const sourceFiles = new Set<string>();

        if (this._debugInfo && this._debugInfo.debugInfo && this._debugInfo.debugInfo.pcToLocs) {
            const pclocs = this._debugInfo.debugInfo.pcToLocs;
            for (const pc of Object.keys(pclocs)) {
                const locList = pclocs[pc];
                for (const loc of locList) {
                    // Resolve absolute path
                    sourceFiles.add(path.resolve(loc.source));
                }
            }
        }

        // Convert to Source objects
        for (const sourcePath of Array.from(sourceFiles)) {
            sources.push(new Source(path.basename(sourcePath), sourcePath));
        }

        // Add disasm file if available
        if (this._disasmPath && fs.existsSync(this._disasmPath)) {
             sources.push(new Source(path.basename(this._disasmPath), this._disasmPath));
        }

        return sources;
    }

    /**
     * Finds the function name for a given return address by looking up the symbol table.
     * A return address falls within a function if: symbol.addr <= returnAddr < symbol.addr + symbol.size
     * Treat size=0 symbols as having at least 1 byte.
     */
    private getFunctionNameForAddress(address: number): string {
        if (!this._debugInfo || !this._debugInfo.symbols || this._debugInfo.symbols.length === 0) {
            return `$${address.toString(16).toUpperCase()}`;
        }

        let bestSymbol = null;
        let minDistance = Infinity;

        for (const symbol of this._debugInfo.symbols) {
            if (symbol.addr <= address) {
                // If the symbol has a defined size, check if the address falls strictly within it
                if (symbol.size && symbol.size > 0) {
                    if (address < symbol.addr + symbol.size) {
                        return symbol.name;
                    }
                }
                
                // Keep track of the closest preceding symbol as a fallback
                const distance = address - symbol.addr;
                if (distance < minDistance) {
                    minDistance = distance;
                    bestSymbol = symbol;
                }
            }
        }

        // If we didn't find a strict match, use the closest preceding symbol
        // (assuming it's reasonably close, e.g., within 4KB)
        if (bestSymbol && minDistance < 4096) {
            return bestSymbol.name;
        }

        // If not found in any symbol, return hex address
        return `$${address.toString(16).toUpperCase()}`;
    }

    /**
     * Reads the 6502 stack pointer and extracts return addresses.
     * Returns array of return addresses found on the stack.
     */
    private async readStackReturnAddresses(): Promise<number[]> {
        const returnAddresses: number[] = [];
        
        try {
            if (!this.regs || !this.regsInv || !this._debugInfo || !this._debugInfo.symbols) {
                console.log(`DEBUG: readStackReturnAddresses() - Missing required data, returning empty`);
                return returnAddresses;
            }

            // Get stack pointer (might be named SP, S, or need to read from $01)
            let spValue: number | undefined;
            
            // Try various SP register names
            for (const spName of ['SP', 'S', 'sp']) {
                const spRegId = this.regsInv[spName]?.id;
                if (spRegId !== undefined) {
                    spValue = this.regs[spRegId]?.value;
                    if (spValue !== undefined) break;
                }
            }

            // If no SP register found, read from memory location $01
            if (spValue === undefined && this.monitor) {
                try {
                    const spBuf = await this.monitor.getMemory(0x01, 0x01, 0);
                    spValue = spBuf[0];
                } catch {
                    console.log(`DEBUG: readStackReturnAddresses() - Failed to read SP from memory`);
                    return returnAddresses;
                }
            }

            if (spValue === undefined) {
                console.log(`DEBUG: readStackReturnAddresses() - SP value is undefined`);
                return returnAddresses;
            }

            console.log(`DEBUG: readStackReturnAddresses() - SP = 0x${spValue.toString(16).toUpperCase()} (${spValue})`);

            // Stack grows downward on 6502, so we read from SP+1 to $1FF
            // Each return address is 16-bit little-endian (address-1 on stack)
            const stackStart = 0x0100 + spValue + 1;
            const stackEnd = Math.min(0x01FF, stackStart + 40); // Limit to 20 frames

            console.log(`DEBUG: readStackReturnAddresses() - 6502 Stack at 0x0100-0x01FF. Reading from 0x${stackStart.toString(16).toUpperCase()} to 0x${stackEnd.toString(16).toUpperCase()} (${stackEnd - stackStart + 1} bytes)`);
            console.log(`DEBUG: readStackReturnAddresses() - Stack absolute address: 0x010${(stackStart - 0x0100).toString(16).toUpperCase()}-0x010${(stackEnd - 0x0100).toString(16).toUpperCase()}`);

            if (stackStart > 0x01FF) {
                console.log(`DEBUG: readStackReturnAddresses() - stackStart > 0x01FF, stack empty`);
                return returnAddresses;
            }

            const stackMemory = await this.retrieveMemory(stackStart, stackEnd, 0);
            console.log(`DEBUG: readStackReturnAddresses() - Stack memory (hex string, first 60 chars): ${stackMemory.substring(0, 60)}`);
            
            // Parse 16-bit little-endian values
            // The stack memory hex string has 2 characters per byte
            for (let i = 0; i <= stackMemory.length - 4; i += 2) {
                const loHex = stackMemory.substr(i, 2);
                const hiHex = stackMemory.substr(i + 2, 2);
                const lo = parseInt(loHex, 16);
                const hi = parseInt(hiHex, 16);
                
                if (!isNaN(lo) && !isNaN(hi)) {
                    // Return address is stored as PC-1, so add 1 to get actual PC
                    const returnAddrStored = (hi << 8) | lo;
                    const returnAddr = returnAddrStored + 1;
                    
                    console.log(`DEBUG: readStackReturnAddresses() - Parsed at offset ${i}: 0x${loHex}${hiHex} = 0x${returnAddrStored.toString(16).toUpperCase()} -> 0x${returnAddr.toString(16).toUpperCase()}`);
                    
                    // Validate: return address must be within program code range
                    // Commodore 64: user code typically $0800-$CFFF
                    // Also check that it exists in our symbol table
                    if (returnAddr >= 0x0800 && returnAddr <= 0xCFFF) {
                        // Additional check: verify this address is actually in a known symbol
                        const funcName = this.getFunctionNameForAddress(returnAddr);
                        if (!funcName.startsWith('$')) {
                            console.log(`DEBUG: readStackReturnAddresses() - 0x${returnAddr.toString(16).toUpperCase()} found in symbol: ${funcName}`);
                            returnAddresses.push(returnAddr);
                            // Skip the next byte since we consumed 2 bytes for this address
                            i += 2;
                        } else {
                            console.log(`DEBUG: readStackReturnAddresses() - 0x${returnAddr.toString(16).toUpperCase()} NOT found in any symbol`);
                        }
                    } else {
                        console.log(`DEBUG: readStackReturnAddresses() - 0x${returnAddr.toString(16).toUpperCase()} outside valid range [0x0800-0xCFFF]`);
                    }
                }
            }
            
            console.log(`DEBUG: readStackReturnAddresses() - Found ${returnAddresses.length} valid return addresses`);
        } catch (err) {
            console.error(`Failed to read stack return addresses: ${err}`);
        }

        return returnAddresses;
    }

    /**
     * Updates the call stack by analyzing return addresses and matching them to functions.
     */
    private async updateCallStack(): Promise<void> {
        try {
            if (!this.regs || !this.regsInv) {
                this.callStack = [];
                return;
            }

            const pcRegId = this.regsInv['PC']?.id;
            if (pcRegId === undefined) {
                return;
            }

            const currentPC = this.regs[pcRegId]?.value;
            if (currentPC === undefined) {
                return;
            }

            const returnAddresses = await this.readStackReturnAddresses();
            console.log(`DEBUG: updateCallStack() - Found ${returnAddresses.length} return addresses`);
            
            if (returnAddresses.length === 0) {
                console.log(`DEBUG: updateCallStack() - No return addresses found. This is normal if:`);
                console.log(`DEBUG: updateCallStack() -   1. Program just started (no JSR executed yet)`);
                console.log(`DEBUG: updateCallStack() -   2. Program is at top level (not inside any function)`);
                console.log(`DEBUG: updateCallStack() -   3. Stack contains only program data, not return addresses`);
            }
            
            this.callStack = [];

            // Build call stack from return addresses
            for (const returnAddr of returnAddresses) {
                // Find the function that contains this return address
                const functionName = this.getFunctionNameForAddress(returnAddr);
                console.log(`DEBUG: Adding frame for return address 0x${returnAddr.toString(16).toUpperCase()} in function ${functionName}`);

                this.callStack.push({
                    address: returnAddr,
                    functionName: functionName,
                    returnAddress: returnAddr
                });
            }
        } catch (err) {
            console.error(`Failed to update call stack: ${err}`);
            this.callStack = [];
        }
    }

    private sendEvent(event: string, ...args: any[]) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }
}
