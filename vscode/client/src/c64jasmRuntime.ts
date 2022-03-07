import * as fs from 'fs';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import { StackFrame, Source } from 'vscode-debugadapter';
import * as utils from './utils';
import { mkdir } from 'fs/promises';
import * as getport from 'get-port';
import * as cmd from './viceCommands';
import { SocketWrapper } from './socketWrapper';

export interface C64jasmBreakpoint {
    id: number;
    line: number;
    verified: boolean;
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
    private responseEater: (b: Buffer) => number | null = null;
    private buffer: Buffer | null = null;
    private regs: C64Regs | null = null;
    private regsInv: C64RegsInv | null = null;
    private disposed: boolean = false;

    constructor(
        echo: (str: string) => void,
        monitorPort: number,
        binaryPort: number) {
        super();
        this.socket = new SocketWrapper(MonitorConnection.localhost, monitorPort);
        this.binarySocket = new SocketWrapper(MonitorConnection.localhost, binaryPort);
        this.echo = echo;
        this.binarySocket.on('data', this.handleIncomingData.bind(this));
    }

    public sendRequest<T extends cmd.Response>(req: cmd.Request<T>, waitResponse: boolean = true): Promise<T> {
        return this.enqueue(async () => await this.sendRequest2(req, waitResponse)) as Promise<T>;
    }

    private async sendRequest2<T extends cmd.Response>(req: cmd.Request<T>, waitResponse: boolean = true): Promise<cmd.Response | null> {
        const p = new Promise<cmd.Response>(async (resolve, reject) => {
            req.setId(this.getRequestId());
            this.responseEater = (buffer: Buffer) => {
                try {
                    const h: cmd.ResponseHeader = cmd.Response.parseHeader(this.buffer);
                    if (h.id === req.id) {
                        req.setResponse(buffer);
                        return cmd.HeaderRespLen + h.bodyLength;
                    }
                } catch {
                }
                return 0;
            };

            this.echo('VICEMON req: ' + req.toString());
            await this.binarySocket.writeBinary(req.getBuffer());
            if (waitResponse) {
                let timeStart = new Date().getTime();
                while ((!req.getResponse()) && (new Date().getTime() - timeStart < 50000))
                    await utils.delay(100);
                const resp: T = req.getResponse();
                if (!resp) {
                    reject(new Error(`Timeout waiting for answer of ${req.toString()}`));
                } else {
                    this.echo(`VICEMON resp: ${resp.toString()}`);
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

    private handleIncomingData(b: Buffer): void {
        if (!this.buffer)
            this.buffer = b;
        else
            this.buffer = Buffer.concat([this.buffer, b]);

        let i = 0;
        const requestStartBytes: number = cmd.STX * 256 + cmd.APIVER;

        while (true) {
            if (!this.buffer)
                break;
            if (this.buffer.length < cmd.HeaderRespLen)
                break;

            // Eat until start of response.
            while (this.buffer.readUInt16LE(i) !== requestStartBytes) i += 1;
            if (i >= this.buffer.length) {
                // If header not found, discard all data.
                this.buffer = null;
                break;
            }
            // Eat discarded data before start of an header.
            this.buffer = this.buffer.slice(i);

            let h: cmd.ResponseHeader | null = null;
            try { h = cmd.Response.parseHeader(this.buffer); } catch (err) { }
            if (!h)
                return;
            else {
                let eaten: number = 0;
                if (this.responseEater) {
                    const size = cmd.HeaderRespLen + h.bodyLength;
                    const buffer: Buffer = this.buffer.slice(0, size);
                    eaten = this.responseEater(buffer);
                    // Eat the consumed data: cmd.HeaderRespLen + h.bodyLength
                    this.buffer = this.buffer.slice(eaten);
                }

                if (!eaten) {
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
                        this.sendEvent('stop', 'break', stoppedResp.pc);
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
                        if (resp.hit)
                            this.sendEvent('stop', 'breakpoint');
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

    private async fetchRegisters(): Promise<void> {
        if (!this.regs) {
            this.regs = {};
            this.regsInv = {};
            const avail = new cmd.RegistersAvailRequest();
            await this.sendRequest<cmd.RegistersAvailResponse>(avail);
            const m = avail.getResponse().map;
            for (const id in m) {
                this.regs[id] = {
                    name: m[id].name, byteCount: m[id].byteCount, value: 0
                };
                this.regsInv[m[id].name] = { id: parseInt(id) };
            }
        }

        const reg = new cmd.RegistersGetRequest();
        await this.sendRequest<cmd.RegistersGetResponse>(reg);
        const r = reg.getResponse();
        this.updateRegisters(r);
    }

    /*    privateonDataReceived(data: any): void {
            const dataString: string = data.toString();
            // Ordinary income data management.
            this.echo(`Recv: ${dataString}`);
            console.log(data.toString());
    
            const bp = this.parseBreakAddr(dataString);
            if (bp) {
                this.emit('break', bp);
            } else {
                this.responseChunks.push(data);
                this.emit('response');
            }
        }*/

    public async waitConnectionDone(): Promise<void> {
        await this.socket.waitConnectionDone();
        await this.binarySocket.waitConnectionDone();

        await this.getVICEInfo();
        await this.fetchRegisters();
    }

    async setBreakpoint(pc: number): Promise<void> {
        const cp = new cmd.CheckpointSetRequest(pc, pc, true, true, cmd.CPUOp.EXEC, false);
        await this.sendRequest<cmd.ContinueResponse>(cp);
    }

    async delBreakpoints(): Promise<void> {
        //??await this.socket.sendRequest(Buffer.from('del'));
    }

    async go(pc?: number): Promise<void> {
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
        try {
            const quit = new cmd.QuitRequest();
            await this.sendRequest<cmd.QuitResponse>(quit);
        } catch {
            //??
        }

        this.socket.dispose();
        this.binarySocket.dispose();
        if (!this.disposed) {
            this.disposed = true;
            this.emit('quit');
        }
    }

    async disass(pc?: number): Promise<void> {
        //??const cmd = pc === undefined ? 'disass' : `disass ${pc.toString(16)}`;
        //??await this.socket.sendRequest(Buffer.from(cmd));
    }

    async textCommand(cmd: string): Promise<void> {
        Promise.resolve(this.socket.writeBinary(Buffer.from(cmd)));
    }

    async loadProgram(prgName: string, startAddress: number, stopOnEntry: boolean): Promise<void> {
        if (stopOnEntry) {
            const set = new cmd.CheckpointSetRequest(
                startAddress, startAddress, true, true,
                cmd.CPUOp.EXEC, true);
            await this.sendRequest<cmd.AutoStartResponse>(set);
            const err = set.getResponse().header.code;
            if (err !== 0) throw new Error(`err code ${err}`);
        }

        const start = new cmd.AutoStartRequest(prgName, true);
        await this.sendRequest<cmd.AutoStartResponse>(start);
        const err = start.getResponse().header.code;
        if (err !== 0) throw new Error(`err code ${err}`);
    }

    private sendEvent(event: string, ...args: any[]) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }

};

type C64jasmDebugInfo = {
    outputPrg: string;
    debugInfo: {
        pcToLocs: {
            [pc: string]: {
                lineNo: number, source: string
            }[];
        }
    }
};

function queryC64jasmDebugInfo(): Promise<C64jasmDebugInfo> {
    const errMsg: string = `Cannot connect to c64jasm server. Please start it with 'c64jasm --server --watch' to build the sources.`;
    return new Promise((resolve, reject) => {
        try {
            const port = 6502;

            const client = net.createConnection({ port, host: "::1", timeout: 5000 }, () => {
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

// This is a super expensive function but at least for now,
// it's only ever run when setting a breakpoint from the UI.
function findSourceLoc(c64jasm: C64jasmDebugInfo | null, path: string, line: number): number | null {
    if (c64jasm && c64jasm.debugInfo) {
        const pclocs = c64jasm.debugInfo.pcToLocs;
        for (const pc of Object.keys(pclocs)) {
            const locList = pclocs[pc];
            for (let i = 0; i < locList.length; i++) {
                const loc = locList[i];
                if (loc.source == path && loc.lineNo == line) {
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
 */
export class C64jasmRuntime extends EventEmitter {
    static readonly defaultMonitorPort: number = 29321;
    static readonly defaultBinaryPort: number = 29745;

    // maps from sourceFile to array of C64jasm breakpoints
    private _breakPoints = new Map<string, C64jasmBreakpoint[]>();

    // since we want to send breakpoint events, we will assign an id to every event
    // so that the frontend can match events with breakpoints.
    private _breakpointId = 1;

    private _monitor: MonitorConnection | undefined = undefined;
    private _debugInfo: C64jasmDebugInfo | null = null;

    private regs: C64Regs | null = null;
    private regsInv: C64RegsInv | null = null

    constructor() {
        super();
    }

    private readonly debugConsoleOutput = (logMsg: string) => {
        this.sendEvent('output', logMsg);
    };

    private async getPort(host: string, start: number, end: number): Promise<number> {
        return await getport({
            port: getport.makeRange(start + Math.floor(Math.random() * 256.), end),
            host: host
        });
    }

    /**
     * Start executing the given program.
     */
    public async start(program: string, stopOnEntry: boolean, vicePath: string): Promise<void> {
        const startAddress = parseBasicSysAddress(program);
        const host = "127.0.0.1";

        // Ask c64jasm compiler for debug information.  This is done
        // by connecting to a running c64jasm process that's watching
        // source files for changes.
        this._debugInfo = await queryC64jasmDebugInfo();

        const monitorPort = await this.getPort(host, C64jasmRuntime.defaultMonitorPort,
            C64jasmRuntime.defaultMonitorPort + 1024);
        const binaryPort = await this.getPort(host, C64jasmRuntime.defaultBinaryPort,
            C64jasmRuntime.defaultBinaryPort + 1024);
        this._monitor = new MonitorConnection(this.debugConsoleOutput, monitorPort, binaryPort);

        // Handle stop on breakpoint
        this._monitor.on('output', (msg) => {
            this.sendEvent('output', msg);
        });
        this._monitor.on('stop', (reason) => {
            this.sendEvent('stop', reason);
        });
        this._monitor.on('continue', () => {
            this.sendEvent('continue');
        });
        this._monitor.on('registers', (regs, regsInv) => {
            this.updateRegisters(regs, regsInv);
        });

        if (!fs.existsSync(program))
            throw new Error(`File ${program} does not exist`);
        const vsFile: string = await this.createCommandsFile(program, startAddress);
        const logFile = utils.toDotC64jasmDir(program, '.log');

        const args = ['-remotemonitor',
            '-initbreak', 'ready',
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
                    resolve([response.body.processId || -1, response.body.shellProcessId || -1]);
                }
            })
        });
        this.emit('output', `Launched [x64sc, pid=${vicePid}] and [shell, pid=${shellPid}]`);

        await this._monitor.waitConnectionDone();
        await this._monitor.loadProgram(program, startAddress, stopOnEntry);

        this.emit('started');
    }

    public async terminate(): Promise<void> {
        if (this._monitor)
            await this._monitor.dispose();
    }

    /**
     * Continue execution.
     */
    public continue(): Promise<void> {
        return this._monitor?.go() ?? Promise.resolve();
    }

    public step(): Promise<void> {
        return this._monitor?.step() ?? Promise.resolve();
    }

    public next(): Promise<void> {
        return this._monitor?.next() ?? Promise.resolve();
    }

    public pause(): Promise<void> {
        return this._monitor?.pause() ?? Promise.resolve();
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
        const pcToLoc = this._debugInfo?.debugInfo.pcToLocs[addr];
        if (pcToLoc) {
            // TODO [0] is wrong, single addr may have more than one?? no?
            const info = pcToLoc[0];
            if (info) {
                return {
                    src: new Source(path.basename(info.source), info.source),
                    line: info.lineNo
                }
            }
        }

        this.debugConsoleOutput(`Cannot find location of address '${addr}'.`);
        return undefined;
    }

    private updateRegisters(r: C64Regs, rInv: C64RegsInv) {
        this.regs = r;
        this.regsInv = rInv
    }

    /**
     * Returns a stack trace for the address where we're currently stopped at.
     */
    public stack(): StackFrame | undefined {
        if (this._debugInfo && this._debugInfo.debugInfo && this.regs && this.regsInv) {
            const address = this.regs[this.regsInv['PC'].id].value;
            const res = this.findSourceLineByAddr(address);
            if (res) {
                const { src, line } = res;
                return new StackFrame(1, src.name, src, line);
            }
        }
        return undefined;
    }

    /*
     * Set breakpoint in file with given line.
     */
    public async setBreakPoint(path: string, line: number): Promise<C64jasmBreakpoint> {
        const bp: C64jasmBreakpoint = { verified: false, line, id: this._breakpointId++ };
        let bps = this._breakPoints.get(path) ?? new Array<C64jasmBreakpoint>();
        this._breakPoints.set(path, bps);
        bps.push(bp);
        await this.verifyBreakpoints(path);
        return bp;
    }

    /*
     * Clear all breakpoints for file.
     */
    public async clearBreakpoints(path: string) {
        // TODO this deletes all VICE monitor breakpoints.
        // Should keep track of set BPs instead and delete the
        // ones that are set for this file.
        if (this._monitor) {
            await this._monitor.delBreakpoints();
            this._breakPoints.delete(path);
        }
    }

    // Disassemble from current PC
    public disass(pc?: number): Promise<void> {
        if (this._monitor)
            return this._monitor.disass(pc);
        else
            return Promise.resolve();
    }

    public textCommand(c: string): Promise<string> {
        return Promise.resolve("");//??return this._monitor.textCommand(c);
    }

    public async retrieveRegisters(): Promise<C64Regs | null> {
        return Promise.resolve(this.regs);
    }

    private async verifyBreakpoints(path: string) {
        if (this._monitor) {
            await this._monitor.delBreakpoints();
            let bps = this._breakPoints.get(path);
            if (bps) {
                for (const bp of bps) {
                    if (!bp.verified) {
                        const addr = findSourceLoc(this._debugInfo, path, bp.line);

                        if (addr) {
                            bp.verified = true;
                            await this._monitor.setBreakpoint(addr);
                            this.sendEvent('breakpointValidated', bp);
                        } else {
                            this.debugConsoleOutput(`Cannot find ${bp}`);
                        }
                    }
                }
            }
        }
    }

    private sendEvent(event: string, ...args: any[]) {
        setImmediate(_ => {
            this.emit(event, ...args);
        });
    }
}
