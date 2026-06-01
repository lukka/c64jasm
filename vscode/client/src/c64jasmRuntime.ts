/// <reference types="node" />
import * as fs from 'fs';
import { EventEmitter } from 'events';
import * as net from 'net';
import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { StackFrame, Source } from 'vscode-debugadapter';
import * as vscode from 'vscode';
import * as utils from './utils';
const { mkdir } = fs.promises;
import getport = require('get-port');
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

enum AdapterState {
    UNINITIALIZED = "uninitialized",
    INITIALIZING = "initializing",
    STARTING_PROGRAM = "starting",
    WAITING_FOR_ENTRY = "wait_entry",
    RUNNING = "running",
    STOPPED = "stopped",
    DISPOSING = "disposing"
}

class MonitorConnection extends EventEmitter {
    static readonly localhost: string = "localhost";
    private readonly socket: SocketWrapper;
    private readonly binarySocket: SocketWrapper;
    private echo: (str: string) => void;
    private workingOnPromise: boolean = false;
    private queue: QueueType[] = [];
    private requestId: number = 0;
    private getRequestId(): number { return ++this.requestId; }
    private responseEater: DataEaterFunction | null;
    private buffer: Buffer | null = null;
    private regs: C64Regs | null = null;
    private regsInv: C64RegsInv | null = null;
    private disposed: boolean = false;
    private abortController: AbortController;
    
    private state: AdapterState = AdapterState.UNINITIALIZED;
    private inProgressOps: Set<string> = new Set();
    private wasRunningBeforeOps: boolean = false;
    private entryPointAddress: number | undefined = undefined;
    private connectionEstablished: boolean = false;
    private stopReasonPending: 'user' | 'break' | 'breakpoint' | 'entry' | 'stepOver' | 'stepIn' | 'stepOut' | null = null;
    private entryCheckpointId: number | undefined = undefined;

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

    public get isConnected(): boolean {
        return this.connectionEstablished;
    }

    public async sendRequestCustom<T extends cmd.Response>(req: cmd.Request<T>,
        dataEater: DataEaterFunction): Promise<T> {
        return this.enqueue(async () => await this.sendRequestCustomAsync(req, dataEater)) as Promise<T>;
    }

    private async sendRequestCustomAsync<T extends cmd.Response>(req: cmd.Request<T>,
        dataEater: DataEaterFunction): Promise<cmd.Response | null> {
        const p = new Promise<cmd.Response>(async (resolve, reject) => {
            try {
                req.setId(this.getRequestId());
                if (this.abortController.signal.aborted) {
                    throw new Error(`Connection to VICE monitor aborted/disposed`);
                }
                this.responseEater = dataEater;
                this.echo('Request sent to VICEMON: ' + req.toString());
                const reqDesc = req.description || req.constructor.name;
                console.log(`\n=================== SENT ===================\n${reqDesc}\n${req.toString()}\n============================================`);
                await this.binarySocket.writeBinary(req.getBuffer());
                const TIMEOUT_MS = 15000;
                let timeStart = performance.now();
                while (!req.tryGetResponse()) {
                    if (this.abortController.signal.aborted) {
                        throw new Error(`Connection to VICE monitor aborted/disposed`);
                    }
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
            } catch (err) {
                reject(err);
            }
        });
        return await p.finally(() => this.responseEater = null);
    }

    public sendRequest<T extends cmd.Response>(req: cmd.Request<T>, waitResponse: boolean = true): Promise<T> {
        return this.enqueue(async () => await this.sendRequestAsync(req, waitResponse)) as Promise<T>;
    }

    private sendRequestAsync<T extends cmd.Response>(req: cmd.Request<T>, waitResponse: boolean = true): Promise<cmd.Response | null> {
        return new Promise<cmd.Response | null>((resolve, reject) => {
            req.setId(this.getRequestId());

            if (this.abortController.signal.aborted && waitResponse) {
                return reject(new Error(`Connection to VICE monitor aborted/disposed`));
            }

            if (!waitResponse) {
                this.echo('Request sent to VICEMON: ' + req.toString());
                const reqDesc = req.description || req.constructor.name;
                console.log(`\n=================== SENT ===================\n${reqDesc}\n${req.toString()}\n============================================`);
                this.binarySocket.writeBinary(req.getBuffer())
                    .then(() => resolve(null))
                    .catch(reject);
                return;
            }

            const TIMEOUT_MS = 15000;
            let settled = false;
            let timer: ReturnType<typeof setTimeout>;

            const onAbort = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    if (this.responseEater === responseEater) this.responseEater = null;
                    reject(new Error(`Connection to VICE monitor aborted/disposed`));
                }
            };

            this.abortController.signal.addEventListener('abort', onAbort);

            const responseEater: DataEaterFunction = (buffer: Buffer) => {
                try {
                    const h: cmd.ResponseHeader = cmd.Response.parseHeader(buffer);
                    if (h.id === req.id) {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timer);
                            this.abortController.signal.removeEventListener('abort', onAbort);
                            if (this.responseEater === responseEater) this.responseEater = null;
                            const resp = req.createResponse(buffer);
                            req.setResponse(resp);
                            this.echo(`Response from VICEMON: ${resp.toString()}`);
                            resolve(resp as T);
                        }
                        return cmd.HeaderRespLen + h.bodyLength;
                    }
                } catch (err) {
                    console.error(`Error in responseEater(): ${err}`);
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        this.abortController.signal.removeEventListener('abort', onAbort);
                        if (this.responseEater === responseEater) this.responseEater = null;
                        reject(new Error(`Error occurred processing response for '${req.type}': ${err}`));
                    }
                    throw err;
                }
                return 0;
            };

            timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.abortController.signal.removeEventListener('abort', onAbort);
                if (this.responseEater === responseEater) this.responseEater = null;
                this.echo(`Waiting for response of VICEMON for request: ${req.toString()}`);
                reject(new Error(`Timeout waiting for answer of ${req.toString()}`));
            }, TIMEOUT_MS);

            this.responseEater = responseEater;
            this.echo('Request sent to VICEMON: ' + req.toString());
            const reqDesc = req.description || req.constructor.name;
            console.log(`\n=================== SENT ===================\n${reqDesc}\n${req.toString()}\n============================================`);
            this.binarySocket.writeBinary(req.getBuffer()).catch(err => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    this.abortController.signal.removeEventListener('abort', onAbort);
                    if (this.responseEater === responseEater) this.responseEater = null;
                    reject(err);
                }
            });
        });
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

    public isStopped(): boolean { return this.state === AdapterState.STOPPED; }

    public setStopped(stopped: boolean): void {
        if (stopped) {
            this.state = AdapterState.STOPPED;
        } else {
            this.state = AdapterState.RUNNING;
        }
    }

    /**
     * Save the current running state before a binary protocol operation.
     * Only captures the pre-batch running state on the very first operation so that
     * subsequent nested operations don't overwrite it.
     */
    public saveRunningState(opName: string = "default"): void {
        if (this.inProgressOps.size === 0) {
            this.wasRunningBeforeOps = (this.state === AdapterState.RUNNING || this.state === AdapterState.WAITING_FOR_ENTRY);
        }
        this.inProgressOps.add(opName);
    }

    /**
     * Called after a binary protocol operation completes.
     * Resumes VICE only when the last in-flight operation finishes, the emulator was
     * running before the batch started, it is still in a stopped state, AND no real
     * stop event (breakpoint or user pause) has been signalled in the meantime.
     */
    public async restoreRunningState(opName: string = "default"): Promise<void> {
        this.inProgressOps.delete(opName);
        if (this.inProgressOps.size === 0 && this.wasRunningBeforeOps && !this.stopReasonPending) {
            await this.go();
        }
    }

    private shouldResumeAfterSpuriousPause(): boolean {
        return this.wasRunningBeforeOps && this.inProgressOps.size > 0 && !this.stopReasonPending;
    }

    private handleIncomingData(b: Buffer): void {
        this.buffer = this.buffer ? Buffer.concat([this.buffer, b] as Uint8Array[]) : b;

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
                this.buffer = this.buffer.slice(2);
                continue;
            }
            if (!h)
                break;

            if (this.buffer.length < cmd.HeaderRespLen + h.bodyLength) {
                break;
            }

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
                    
                    if (this.state === AdapterState.WAITING_FOR_ENTRY) {
                        if (this.entryPointAddress !== undefined && stoppedResp.pc !== this.entryPointAddress) {
                            if (this.inProgressOps.size > 0) {
                                // Spurious pause caused by an in-flight binary-protocol operation
                                // during initialization. restoreRunningState() will resume once complete.
                                console.log(`[C64jasmRuntime] Intermediate stop at 0x${stoppedResp.pc.toString(16)}. inProgressOps:`, Array.from(this.inProgressOps));
                            } else {
                                // Sometimes VICE stops momentarily during autostart or before reaching
                                // the entry point checkpoint even without explicit binary requests.
                                console.log(`Intermediate stop at 0x${stoppedResp.pc.toString(16)} during initialization. Resuming to reach entry point...`);
                                this.go();
                            }
                            continue;
                        }
                        this.state = AdapterState.STOPPED;
                        this.stopReasonPending = 'entry';
                        
                        if (this.entryCheckpointId !== undefined) {
                            try {
                                const delReq = new cmd.CheckpointDeleteRequest(this.entryCheckpointId);
                                this.sendRequest(delReq, false).catch(e => console.error(e));
                            } catch (e) {
                                // ignore
                            }
                            this.entryCheckpointId = undefined;
                        }

                        this.sendEvent('stop', 'entry', stoppedResp.pc);
                    } else if (this.state === AdapterState.RUNNING || this.state === AdapterState.STOPPED) {
                        this.state = AdapterState.STOPPED;
                        if (this.stopReasonPending === 'user') {
                            // User explicitly pressed the Stop/Pause button.
                            this.stopReasonPending = null;
                            this.sendEvent('stop', 'user', stoppedResp.pc);
                        } else if (this.stopReasonPending === 'stepOver' || this.stopReasonPending === 'stepIn' || this.stopReasonPending === 'stepOut') {
                            // Step completed reliably inside emulator.
                            const reason = this.stopReasonPending;
                            this.stopReasonPending = null;
                            this.sendEvent('stop', reason, stoppedResp.pc);
                        } else if (this.breakpoints.has(stoppedResp.pc)) {
                            // PC is sitting on a registered breakpoint address — real stop.
                            this.stopReasonPending = 'breakpoint'; // BUG: reason must be 'breakpoint', not 'break', or else VS Code ignores UI pause!
                            this.sendEvent('stop', 'breakpoint', stoppedResp.pc);
                        } else if (this.shouldResumeAfterSpuriousPause()) {
                            // Spurious pause caused by an in-flight binary-protocol operation
                            // AND no real stop event is pending.
                            // We purposefully do not call this.go() here. Keeping it paused
                            // during a multi-request operation (like a memory batch) prevents
                            // the emulator from sputtering stop-start-stop-start.
                            // restoreRunningState() will cleanly resume once the batch completes.
                        }
                        // else: was already stopped before the operation, or a real stop (breakpoint/entry)
                        // is pending — stay stopped silently.
                    } else {
                        // During initialization or starting phase stops, just record emulator is stopped
                        this.state = AdapterState.STOPPED;
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
                    // Don't switch to running if we are strictly waiting for the entry stop
                    if (this.state !== AdapterState.WAITING_FOR_ENTRY) {
                        this.state = AdapterState.RUNNING;
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

                    // If we hit a checkpoint during initialization, this is the stopOnEntry breakpoint.
                    // However, we rely entirely on StoppedResponse to carefully validate if the PC
                    // matches the entry point address and securely handle the correct stop.
                    // We safely ignore CheckpointResponse hit event during the initializing phase.
                    if (resp.hit) {
                        if (this.state === AdapterState.WAITING_FOR_ENTRY) {
                            // Handled by StoppedResponse
                        } else {
                            this.state = AdapterState.STOPPED;
                            this.stopReasonPending = 'breakpoint';
                            this.sendEvent('stop', 'breakpoint');
                        }
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

    private async withSavedRunningState<T>(opName: string, action: () => Promise<T>): Promise<T> {
        // Append a unique ID in case the same operation is called concurrently multiple times
        const uniqueOpName = `${opName}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        this.saveRunningState(uniqueOpName);
        try {
            return await action();
        } finally {
            await this.restoreRunningState(uniqueOpName);
        }
    }

    public async getAvailableBanks(): Promise<cmd.BankInfo[]> {
        return this.withSavedRunningState("getAvailableBanks", async () => {
            const req = new cmd.BanksAvailableRequest();
            const res = await this.sendRequest<cmd.BanksAvailableResponse>(req);
            return res.banks;
        });
    }

    public async getMemory(start: number, end: number, bankId: number = 0): Promise<Buffer> {
        return this.withSavedRunningState(`getMemory:${start.toString(16)}-${end.toString(16)}`, async () => {
            const memReq = new cmd.MemoryGetRequest(this.getRequestId(), start, end, bankId);
            const memRes = await this.sendRequest<cmd.MemoryGetResponse>(memReq);
            return memRes.memory;
        });
    }

    public async getMemoryBatch(requests: Array<{ start: number, end: number, bankId?: number, tag: string }>): Promise<Array<{ memory: Buffer, tag: string }>> {
        return this.withSavedRunningState(`getMemoryBatch:${requests.map(r => r.tag).join(",")}`, async () => {
            const results: Array<{ memory: Buffer, tag: string }> = [];
            for (const req of requests) {
                const memReq = new cmd.MemoryGetRequest(this.getRequestId(), req.start, req.end, req.bankId ?? 0);
                try {
                    const memRes = await this.sendRequest<cmd.MemoryGetResponse>(memReq);
                    results.push({ memory: memRes.memory, tag: req.tag });
                } catch (e) {
                    console.error("Failed to get memory batch item:", req, e);
                }
            }
            return results;
        });
    }

    public async setMemory(address: number, value: number, bankId: number = 0): Promise<void> {
        return this.withSavedRunningState(`setMemory:${address.toString(16)}`, async () => {
            const buffer = Buffer.alloc(1);
            buffer.writeUInt8(value, 0);
            const memReq = new cmd.MemorySetRequest(address, address, bankId, buffer);
            const resp = await this.sendRequest<cmd.MemorySetResponse>(memReq);

            if (resp.isError()) {
                throw new Error(`Failed to set memory at 0x${address.toString(16)}: ${resp.getErrorMessage()}`);
            }
        });
    }

    public async setMemoryBlock(address: number, data: Uint8Array, bankId: number = 0): Promise<void> {
        return this.withSavedRunningState(`setMemoryBlock:${address.toString(16)}`, async () => {
            const buffer = Buffer.from(data);
            const memReq = new cmd.MemorySetRequest(address, address + data.length - 1, bankId, buffer);
            const resp = await this.sendRequest<cmd.MemorySetResponse>(memReq);

            if (resp.isError()) {
                throw new Error(`Failed to set memory starting at 0x${address.toString(16)}: ${resp.getErrorMessage()}`);
            }
        });
    }

    public async setRegister(register: string, value: number): Promise<void> {
        return this.withSavedRunningState(`setRegister:${register}`, async () => {
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
        });
    }

    public async getCpuHistory(historyCount: number): Promise<cmd.CpuHistoryItem[]> {
        return this.withSavedRunningState("getCpuHistory", async () => {
            const hc = new cmd.CpuHistoryGetRequest(historyCount);
            const resp = await this.sendRequest<cmd.CpuHistoryGetResponse>(hc);
            return resp.items;
        });
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
        return this.withSavedRunningState(`setBreakpoint:${pc.toString(16)}`, async () => {
            const cpr = new cmd.CheckpointSetRequest(pc, pc, true, true, cmd.CPUOp.EXEC, false);
            const cp = await this.sendRequest<cmd.CheckpointResponse>(cpr);

            if (cp.isError()) {
                throw new Error(`Failed to set breakpoint at 0x${pc.toString(16)}: ${cp.getErrorMessage()}`);
            }

            this.breakpoints.set(pc, cp);
            return cp.checkpointId;
        });
    }

    async setCondition(checkpointId: number, condition: string): Promise<void> {
        return this.withSavedRunningState(`setCondition:${checkpointId}`, async () => {
            const req = new cmd.ConditionSetRequest(checkpointId, condition);
            const resp = await this.sendRequest<cmd.ConditionSetResponse>(req);

            if (resp.isError()) {
                throw new Error(`Failed to set condition "${condition}" on checkpoint ${checkpointId}: ${resp.getErrorMessage()}`);
            }
        });
    }

    async delBreakpoints(): Promise<void> {
        return this.withSavedRunningState("delBreakpoints", async () => {
            const req = new cmd.CheckpointListRequest();
            function dataEater(buffer: Buffer): number {
                try {
                    const header: cmd.ResponseHeader = cmd.Response.parseHeader(buffer);
                    const typeName = cmd.ResponseTypeNames.get(header.type) || "Unknown Response";
                    console.log(`\n================== RECVD ==================\n${typeName}\nParsed header: ${cmd.toString(header)}\n===========================================`);

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

            // First get the list of ALL breakpoints from VICE, including stray ones.
            const existingBreakpoints = await this.sendRequestCustom<cmd.CheckpointListFakeResponse>(req, dataEater);

            await utils.delay(500);
            for (const cpId of existingBreakpoints.checkpointIds) {
                try {
                    const cdr = new cmd.CheckpointDeleteRequest(cpId);
                    await this.sendRequest<cmd.CheckpointDeleteResponse>(cdr);
                } catch (err) {
                    this.emit('output', `Error deleting breakpoint ${cpId}: ${err}`);
                }
            }
            this.breakpoints.clear();
        });
    }

    async go(pc?: number): Promise<void> {
        this.state = AdapterState.RUNNING;
        this.stopReasonPending = null;
        this.sendEvent('continue');
        const avail = new cmd.ContinueRequest();
        await this.sendRequest<cmd.ContinueResponse>(avail);
    }

    public async next(): Promise<void> {
        this.state = AdapterState.RUNNING;
        this.stopReasonPending = 'stepOver';
        this.sendEvent('continue');
        const next = new cmd.StepOverRequest();
        await this.sendRequest<cmd.StepOverResponse>(next);
    }

    public async step(): Promise<void> {
        this.state = AdapterState.RUNNING;
        this.stopReasonPending = 'stepIn';
        this.sendEvent('continue');
        const step = new cmd.StepInRequest();
        await this.sendRequest<cmd.StepInResponse>(step);
    }

    public async stepOut(): Promise<void> {
        this.state = AdapterState.RUNNING;
        this.stopReasonPending = 'stepOut';
        this.sendEvent('continue');
        const step = new cmd.StepOutRequest();
        await this.sendRequest<cmd.StepOutResponse>(step);
    }

    async pause(): Promise<void> {
        this.stopReasonPending = 'user';
        const regs = new cmd.RegistersGetRequest();
        await this.sendRequest<cmd.RegistersGetResponse>(regs);
        // If StoppedResponse already consumed the flag, the stop event was already sent.
        // If VICE was already paused (no StoppedResponse arrives), emit directly.
        if (this.stopReasonPending === 'user') {
            this.stopReasonPending = null;
            this.emit('stop', 'user');
        }
    }

    async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;

            try {
                const quit = new cmd.QuitRequest();
                await this.sendRequest<cmd.QuitResponse>(quit, false);
            } catch {
                //?? TODO ignore all errors.
            }

            // Abort the controller to signal sockets and pending queues to stop
            this.abortController.abort();

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
        
        this.state = AdapterState.STARTING_PROGRAM;
        
        if (stopOnEntry) {
            const set = new cmd.CheckpointSetRequest(
                startAddress, startAddress, true, true,
                cmd.CPUOp.EXEC, false); // Make it a permanent breakpoint instead of temp to survive autostart resets
            const setResp = await this.sendRequest<cmd.CheckpointResponse>(set);
            if (setResp.isError()) {
                throw new Error(`Failed to set entry checkpoint at 0x${startAddress.toString(16)}: ${setResp.getErrorMessage()}`);
            }
            this.entryCheckpointId = setResp.checkpointId;
        }

        const start = new cmd.AutoStartRequest(prgName, true);
        
        // As soon as we send autostart, we consider the program to be running.
        // We switch our state now because VICE might emit the StoppedResponse
        // event synchronously while we await this startResp.
        if (stopOnEntry) {
            this.state = AdapterState.WAITING_FOR_ENTRY;
        }

        const startResp = await this.sendRequest<cmd.AutoStartResponse>(start);
        if (startResp.isError()) {
            throw new Error(`Failed to autostart program "${prgName}": ${startResp.getErrorMessage()}`);
        }

        // If not stopping on entry, the program is just running normally.
        if (!stopOnEntry) {
            this.state = AdapterState.RUNNING;
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
    };
    error?: string; // Set when compilation fails
};

let c64jasmServerProcess: ChildProcess | null = null;
let c64jasmServerArgs: { sourceFile: string, outputPath: string } | null = null;
let viceProcessId: number | null = null;

function startC64jasmServer(
    sourceFile: string,
    prgPath: string,
    disasmPath: string | undefined,
    emitOutput: (msg: string, stream?: 'stdout' | 'stderr') => void,
    isDevelopmentMode: boolean = false,
    useEmbeddedCompiler: boolean = true,
    abortSignal?: AbortSignal
): Promise<void> {
    return new Promise((resolve, reject) => {
        let aborted = false;

        const onAbort = () => {
            aborted = true;
            reject(new Error('Server startup cancelled by user'));
        };

        if (abortSignal) {
            if (abortSignal.aborted) {
                return onAbort();
            }
            abortSignal.addEventListener('abort', onAbort);
        }

        const cleanup = () => {
            if (abortSignal) {
                abortSignal.removeEventListener('abort', onAbort);
            }
        };

        // Check if server is already running with the same arguments
        if (c64jasmServerProcess && c64jasmServerArgs) {
            if (c64jasmServerArgs.sourceFile === sourceFile && c64jasmServerArgs.outputPath === prgPath) {
                console.log(`c64jasm server already running with same arguments (pid=${c64jasmServerProcess.pid})`);
                cleanup();
                resolve();
                return;
            }
            // Different arguments, stop the old server
            console.log(`Stopping previous c64jasm server (pid=${c64jasmServerProcess.pid}) - different arguments`);
            try {
                c64jasmServerProcess.kill('SIGTERM');
            } catch (err) {
                console.error(`Failed to kill previous server: ${err}`);
            }
            c64jasmServerProcess = null;
            c64jasmServerArgs = null;
        }

        try {
            const finalDisasmPath = disasmPath || prgPath.replace(/\.prg$/, '.disasm');
            const sourceDir = path.dirname(sourceFile);
            const args = [
                '--watch', sourceDir,
                '--out', prgPath,
                '--server', sourceFile,
                '--disasm', finalDisasmPath
            ];
            
            let cmdPath: string;
            
            if (isDevelopmentMode) {
                // When in development mode, compute path to kick project's cli.js
                // __dirname when compiled is in client/out, so go up to vscode root, then up to kick root
                cmdPath = path.join(__dirname, '..', '..', '..', 'build', 'src', 'cli.js');
            } else if (useEmbeddedCompiler !== false) {
                // In production, run the bundled cli.js file packaged inside the extension.
                cmdPath = path.join(__dirname, 'cli.js');
            } else {
                cmdPath = 'c64jasm';
            }

            // Launch c64jasm silently using child_process.fork
            if (cmdPath === 'c64jasm') {
                const { spawn } = require('child_process');
                c64jasmServerProcess = spawn(cmdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            } else {
                c64jasmServerProcess = fork(cmdPath, args, { silent: true, execArgv: [] });
            }

            if (c64jasmServerProcess!.stdout) {
                c64jasmServerProcess!.stdout!.on('data', (data: any) => {
                    emitOutput(data.toString(), 'stdout');
                });
            }
            if (c64jasmServerProcess!.stderr) {
                c64jasmServerProcess!.stderr!.on('data', (data: any) => {
                    emitOutput(data.toString(), 'stderr');
                });
            }

            c64jasmServerProcess!.on('error', (err: Error) => {
                 console.error(`c64jasm server error: ${err}`);
            });

            if (!c64jasmServerProcess!.pid) {
                 reject(new Error(`Failed to start c64jasm server`));
                 return;
            }

            c64jasmServerArgs = { sourceFile, outputPath: prgPath };
            console.log(`c64jasm server started with pid=${c64jasmServerProcess!.pid || 'unknown'}`);

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
                        await queryC64jasmDebugInfo(sourceFile, prgPath, disasmPath, false, undefined, isDevelopmentMode, useEmbeddedCompiler, abortSignal);
                        console.log('c64jasm server is ready');
                        cleanup();
                        resolve();
                        return;
                    } catch {
                        // Server not ready yet, continue polling
                    }

                    // Wait before next poll
                    await utils.delay(POLL_INTERVAL_MS);
                }

                // Timeout reached
                cleanup();
                reject(new Error('Timeout waiting for c64jasm server to start (60s)'));
            };

            pollServer();
        } catch (err) {
            cleanup();
            reject(err);
        }
    });
}

function stopC64jasmServer(): void {
    // Kill the running server process
    if (c64jasmServerProcess) {
        try {
            console.log(`Stopping c64jasm server (pid=${c64jasmServerProcess.pid})`);
            c64jasmServerProcess.kill('SIGTERM');
        } catch (err) {
            console.error(`Failed to stop c64jasm server: ${err}`);
        }
        c64jasmServerProcess = null;
        c64jasmServerArgs = null;
    }
}

function queryC64jasmDebugInfo(
    sourceFile: string,
    outputPath: string,
    disasmPath: string | undefined,
    autoStart: boolean = true,
    emitOutput?: (msg: string, stream?: 'stdout' | 'stderr') => void,
    isDevelopmentMode: boolean = false,
    useEmbeddedCompiler?: boolean,
    abortSignal?: AbortSignal
): Promise<C64jasmDebugInfo> {
    const errMsg: string = `Cannot connect to c64jasm server. Please start it with 'c64jasm --server --watch' to build the sources.`;

    const attemptConnection = (host: string): Promise<C64jasmDebugInfo> => {
        return new Promise((resolve, reject) => {
            if (abortSignal?.aborted) {
                return reject(new Error("queryC64jasmDebugInfo aborted"));
            }

            try {
                const port = 6502;

                const client = net.createConnection({
                    port, host,
                    timeout: 5000
                }, () => {
                    if (abortSignal?.aborted) return;
                    client.write('debug-info\r\n');
                });

                const onAbort = () => {
                    client.destroy();
                    reject(new Error("queryC64jasmDebugInfo aborted"));
                };

                if (abortSignal) {
                    abortSignal.addEventListener('abort', onAbort);
                }

                const cleanup = () => {
                    if (abortSignal) {
                        abortSignal.removeEventListener('abort', onAbort);
                    }
                };

                const chunks: Buffer[] = [];
                client.on('data', data => {
                    chunks.push(data);
                }).on('end', () => {
                    cleanup();
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks as Uint8Array[]).toString()));
                    } catch (e) {
                        reject(new Error(`Failed to parse debug info from c64jasm server: ${e}`));
                    }
                }).on("error", err => {
                    cleanup();
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
        if (autoStart && emitOutput) {
            // Try to start the server and retry
            try {
                await startC64jasmServer(sourceFile, outputPath, disasmPath, emitOutput, isDevelopmentMode, useEmbeddedCompiler);
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

    private _monitor = new utils.AsyncMutableDisposable<MonitorConnection>();
    get monitor(): MonitorConnection | undefined {
        return this._monitor.value;
    }
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
    public async start(program: string, stopOnEntry: boolean, vicePath: string, sourceFile: string, disasmPath: string | undefined, extensionMode?: vscode.ExtensionMode, useEmbeddedCompiler?: boolean): Promise<void> {
        const host = "127.0.0.1";

        this._disasmPath = disasmPath ?? program.replace(/\.prg$/, '.disasm');

        // Determine if we're in development mode
        const isDevelopmentMode = extensionMode === vscode.ExtensionMode.Development;

        // Abort any pending connection attempts
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }

        // Create abort controller for connection attempts
        this.abortController = new AbortController();

        // Ask c64jasm compiler for debug information.  This is done
        // by connecting to a running c64jasm process that's watching
        // source files for changes.
        this._debugInfo = await queryC64jasmDebugInfo(
            sourceFile,
            program,
            this._disasmPath,
            true,
            (msg, stream) => {
                // Forward the output to the debug console
                this.sendEvent('output', msg);
            },
            isDevelopmentMode,
            useEmbeddedCompiler,
            this.abortController?.signal
        );

        if (this._debugInfo && this._debugInfo.error) {
            let errorMsg = this._debugInfo.error;
            if (errorMsg.endsWith('.')) errorMsg = errorMsg.slice(0, -1);
            if (!errorMsg.toLowerCase().includes('compilation failed')) errorMsg = `Compilation failed: ${errorMsg}`;
            throw new Error(`${errorMsg}. Please check the c64jasm debug srv terminal for details.`);
        }

        const startAddress = parseBasicSysAddress(program);

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

        // This will automatically dispose the old monitor connection if it exists
        await this._monitor.setValue(new MonitorConnection(this.debugConsoleOutput, monitorPort, binaryPort, this.abortController));

        // Handle stop on breakpoint and other events from VICE.
        this.monitor!.on('output', (msg) => {
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

        // Stop previous VICE instance if running
        if (viceProcessId && viceProcessId > 0) {
            console.log(`Stopping previous VICE instance (pid=${viceProcessId})`);
            try {
                process.kill(viceProcessId, 'SIGTERM');

                // Wait for the process to actually terminate
                const startTime = performance.now();
                while (performance.now() - startTime < 5000) {
                    if (this.abortController?.signal.aborted) {
                        break;
                    }
                    try {
                        process.kill(viceProcessId, 0);
                        await utils.delay(50);
                    } catch (e: any) {
                        if (e.code === 'ESRCH') break;
                    }
                }
            } catch (err: any) {
                if (err.code !== 'ESRCH') {
                    console.error(`Failed to kill previous VICE instance: ${err}`);
                }
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
                title: `VICE localhost:${monitorPort}`,
                kind: 'integrated'
            }, 10000, (response: any) => {
                if (!response.success) {
                    reject(response);
                } else {
                    const pid = response.body?.processId || null;
                    const shellPid = response.body?.shellProcessId || null;
                    if (!pid) {
                        console.warn('Warning: runInTerminal did not return a processId for VICE');
                    }
                    resolve([pid, shellPid]);
                }
            })
        });
        viceProcessId = vicePid;
        this.emit('output', `Launched [VICE (${path.basename(vicePath)}), pid=${vicePid || 'unknown'}] and [shell, pid=${shellPid || 'unknown'}]`);

        // Wait for VICE to open its monitor and binary protocol ports
        try {
            this.emit('output', `Waiting for VICE monitor port ${monitorPort} to become available...`);
            await utils.waitForPort(host, monitorPort, 30000, 1000, this.abortController?.signal);
            this.emit('output', `Waiting for VICE binary port ${binaryPort} to become available...`);
            await utils.waitForPort(host, binaryPort, 30000, 1000, this.abortController?.signal);
            this.emit('output', 'VICE ports are ready, connecting...');

            await this.monitor?.waitConnectionDone();

            // Initialize call stack trackers
            this.callStack = [];

            await this.monitor?.loadProgram(program, startAddress, stopOnEntry);

            // Verify and set all breakpoints that were registered before VICE started
            for (const [path, _] of this._breakpoints.entries()) {
                await this.verifyBreakpoints(path);
            }

            this.emit('started');
        } catch (err) {
            // Clean up on connection failure
            await this._monitor.clear();
            throw err;
        }
    }

    public async terminate(): Promise<void> {
        // Abort any pending connection attempts immediately
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }

        if (this._monitor.value) {
            try {
                if (this._monitor.value.isConnected) {
                    const quit = new cmd.QuitRequest();
                    // Don't wait too long for quit response as we want to shut down quickly
                    const quitPromise = this._monitor.value.sendRequest<cmd.QuitResponse>(quit, false);
                    await Promise.race([quitPromise, utils.delay(500)]);
                }
            } catch {
                // Ignore if it fails
            }
        }

        await this._monitor.clear();

        const vicePidToKill = viceProcessId;
        viceProcessId = null;

        stopC64jasmServer();

        // Stop VICE emulator
        if (vicePidToKill && vicePidToKill > 0) {
            let processDied = false;
            const gracefulStart = performance.now();
            while (performance.now() - gracefulStart < 2000) {
                try {
                    process.kill(vicePidToKill, 0);
                    await utils.delay(50);
                } catch (e: any) {
                    if (e.code === 'ESRCH') {
                        processDied = true;
                        break;
                    }
                }
            }

            if (!processDied) {
                try {
                    console.log(`VICE (pid=${vicePidToKill}) did not quit gracefully, sending SIGTERM`);
                    process.kill(vicePidToKill, 'SIGTERM');

                    // Wait for the process to actually terminate
                    const startTime = performance.now();
                    while (performance.now() - startTime < 5000) {
                        try {
                            // Sending signal 0 checks if process exists without sending a signal
                            process.kill(vicePidToKill, 0);
                            await utils.delay(50);
                        } catch (e: any) {
                            if (e.code === 'ESRCH') {
                                break;
                            }
                            break;
                        }
                    }
                } catch (err: any) {
                    // Ignore ESRCH (No such process), which means it's already dead
                    if (err.code !== 'ESRCH') {
                        console.error(`Failed to stop VICE: ${err}`);
                    }
                }
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

    public stepOut(): Promise<void> {
        return this.monitor?.stepOut() ?? Promise.resolve();
    }

    public async getScreenshot(): Promise<cmd.DisplayGetResponse> {
        if (!this.monitor) throw new Error("Monitor not connected");
        return await this.monitor.sendRequest(new cmd.DisplayGetRequest(true, 0x00)); // Indexed 8-bit
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

    public findSourceLineByAddr(addr: number) {
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

            // delBreakpoints() removes ALL breakpoints from VICE, so we need to
            // re-validate and re-add breakpoints for any OTHER files.
            for (const [p, bps] of this._breakpoints.entries()) {
                for (const bp of bps) {
                    bp.verified = false; // Force re-validation
                }
                await this.verifyBreakpoints(p);
            }
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

        const isAbsolutePath = name.startsWith('::');
        const nameToFind = isAbsolutePath ? name.toLowerCase().substring(2) : name.toLowerCase();

        // Helper function to find symbol by exact match or FQN suffix
        const findByName = <T extends { name: string }>(items: T[] | undefined): T | undefined => {
            if (!items) return undefined;

            // Try exact match first
            let match = items.find(s => s.name.toLowerCase() === nameToFind);
            if (match) return match;

            // If it was explicitly an absolute path, don't fall back to suffix matching
            if (isAbsolutePath) return undefined;

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

    public async getAvailableBanks(): Promise<cmd.BankInfo[]> {
        if (this.monitor) {
            return await this.monitor.getAvailableBanks();
        }
        return [];
    }

    public async retrieveMemory(start: number, end: number, bankId: number = 0): Promise<string> {
        if (this.monitor) {
            const memory = await this.monitor.getMemory(start, end, bankId);
            return memory.toString('hex');
        }
        return '';
    }

    public async retrieveMemoryBatch(requests: Array<{ start: number, end: number, bankId?: number, tag: string }>): Promise<Array<{ memory: string, tag: string }>> {
        if (this.monitor) {
            const results = await this.monitor.getMemoryBatch(requests);
            return results.map(r => ({ memory: r.memory.toString('hex'), tag: r.tag }));
        }
        return [];
    }

    public async getCpuHistory(historyCount: number): Promise<cmd.CpuHistoryItem[]> {
        if (this.monitor) {
            return await this.monitor.getCpuHistory(historyCount);
        }
        return [];
    }

    public async writeMemory(address: number, value: number, bankId: number = 0): Promise<void> {
        if (this.monitor) {
            await this.monitor.setMemory(address, value, bankId);
        }
    }

    public async writeMemoryBlock(address: number, data: Uint8Array, bankId: number = 0): Promise<void> {
        if (this.monitor) {
            await this.monitor.setMemoryBlock(address, data, bankId);
        }
    }

    public findAddressBySourceLine(sourcePath: string, line: number): number | null {
        return findSourceLoc(this._debugInfo, sourcePath, line);
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
            const allInstructions: Array<{ addr: number, line: string, byteCount: number }> = [];
            for (const line of lines) {
                const match = line.match(/^([0-9A-Fa-f]{1,4}):\s+([0-9A-Fa-f\s…]+?)(?:\s{2,}(\S.*))?$/);
                if (match) {
                    const addr = parseInt(match[1], 16);
                    // Count bytes in the hex portion (excluding ellipsis)
                    const bytesStr = match[2].replace(/…/g, '').trim().split(/\s+/).filter(b => b);
                    const byteCount = bytesStr.length;
                    allInstructions.push({ addr, line, byteCount });
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

