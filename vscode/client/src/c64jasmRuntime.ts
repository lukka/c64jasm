import * as fs from 'fs';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import { StackFrame, Source } from 'vscode-debugadapter';
import * as utils from './utils'
import { mkdir } from 'fs/promises';
import * as lodash from 'lodash'
import * as getport from 'get-port';

export interface C64jasmBreakpoint {
    id: number;
    line: number;
    verified: boolean;
}

export interface C64Regs {
    PC: number;
    A: number;
    X: number;
    Y: number;
    SP: number;
    V0: number;
    V1: number;
    FL: number;
    LN: number;
    CY: number;
    SW: number;
}

export const c64regs: C64Regs = { PC: 0, A: 0, X: 0, Y: 0, SP: 0, V0: 0, V1: 0, FL: 0, LN: 0, CY: 0, SW: 0 };

type QueueType = {
    promise: () => Promise<string | null>,
    resolve: (value: string | null) => void,
    reject: (reason?: any) => void
};

class MonitorConnection extends EventEmitter {
    private socket: net.Socket = new net.Socket({ readable: true, writable: true });
    private echo: (str: string) => void;
    private readonly opts: net.TcpSocketConnectOpts;
    private retryingConnect: boolean = false;
    private isConnected: boolean = false;
    private responseChunks: Buffer[] = [];
    private responseMessage: string | null = null;
    private workingOnPromise: boolean = false;
    private readonly debounceIncomingDataTimeout = 400;
    private disposed: boolean = false;
    private queue: QueueType[] = [];

    constructor(
        echo: (str: string) => void,
        monitorPort: number) {
        super();
        this.echo = echo;
        this.opts = { port: monitorPort };
        this.socket.on('connect', this.onConnected.bind(this));
        this.socket.on('close', this.onClosed.bind(this));
        this.socket.on('data', this.onDataReceived.bind(this));
        this.socket.on('error', this.onError.bind(this));
        this.onResponse = lodash.debounce(this.onResponse.bind(this), this.debounceIncomingDataTimeout);
        this.on('response', this.onResponse.bind(this));
    }

    sendVICERequest(msg: string, waitResponse: boolean = true): Promise<string | null> {
        return this.enqueue(async () => await this.sendVICERequest2(msg, waitResponse));
    }

    private async sendVICERequest2(msg: string, waitResponse: boolean = true): Promise<string | null> {
        const newlineCount = (text: string) => text.split('\n').length;
        try {
            let response: string | null = null;
            this.responseMessage = null;
            this.echo('VICEMON req: ' + msg);
            this.socket.write(msg + '\n');
            if (waitResponse) {
                while (!this.responseMessage || !newlineCount(this.responseMessage))
                    await utils.delay(this.debounceIncomingDataTimeout / 4);
                response = this.responseMessage;
                this.responseMessage = null;
                this.echo('VICEMON ans: ' + response);
            }
            return response;
        } catch (err) {
            console.log(err);
            return null;
        }
    }

    private enqueue(promise: () => Promise<string | null>): Promise<string | null> {
        return new Promise<string | null>((resolve, reject) => {
            this.queue.push({
                promise,
                resolve,
                reject,
            });
            this.dequeue();
        });
    }

    private dequeue(): boolean {
        if (this.workingOnPromise) {
            return false;
        }
        const item = this.queue.shift();
        if (!item) {
            return false;
        }
        try {
            this.workingOnPromise = true;
            item.promise()
                .then((value: string | null) => {
                    this.workingOnPromise = false;
                    item.resolve(value);
                    this.dequeue();
                })
                .catch(err => {
                    this.workingOnPromise = false;
                    item.reject(err);
                    this.dequeue();
                })
        } catch (err) {
            this.workingOnPromise = false;
            item.reject(err);
            this.dequeue();
        }
        return true;
    }

    onResponse() {
        this.responseMessage = Buffer.concat(this.responseChunks).toString();
        this.responseChunks = [];
    }

    connect(): void {
        if (!this.disposed)
            this.socket.connect(this.opts);
    }

    private onError(err: Error) {
        this.isConnected = false;
        this.retryingConnect = false;
        console.log(`Error on connection to VICE monitor (${err})`);
    }

    private onConnected(): void {
        this.isConnected = true;
        this.retryingConnect = false;
        console.log('Connected to VICE monitor');
    }

    private onClosed(): void {
        this.isConnected = false;

        console.log('Disconnected to VICE monitor');
        if (!this.disposed)
            if (!this.retryingConnect) {
                this.retryingConnect = true;
                setTimeout(() => {
                    if (!this.disposed) this.connect();
                }, 500);
            }
    }

    private parseBreakAddr(dataString: string): number | null {
        let bp: number | null = null;
        const lines = utils.toLines(dataString);
        // #1 (Stop on  exec 080d)    0/$000,   7/$07
        // .C:080d  20 8C 08    JSR $088C      - A:00 X:00 Y:0A SP:f3 ..-...Z.   23194087
        const breakRe = /\s*\(Stop\s+on\s+exec\s+([0-9a-fA-F]{4})/;
        for (const line of lines) {
            let match = line.match(breakRe);
            if (match) {
                bp = parseInt(match[1], 16);
            }
        }
        return bp;
    }

    private parseNextBreakAddr(dataString: string): number | null {
        let bp: number | null = null;
        const lines = utils.toLines(dataString);
        const breakRe = /\.C\:([0-9a-fA-F]{4})\s+/;
        for (const line of lines) {
            let match = line.match(breakRe);
            if (match) {
                bp = parseInt(match[1], 16);
            }
        }
        return bp;
    }

    private onDataReceived(data: any): void {
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
    }

    async waitConnectionDone(): Promise<void> {
        //?? Infinite loop TODO
        while (!this.isConnected) {
            await utils.delay(500);
        }
    }

    async setBreakpoint(pc: number): Promise<void> {
        const cmd = `break ${pc.toString(16)}`;
        await this.sendVICERequest(cmd);
    }

    async delBreakpoints(): Promise<void> {
        await this.sendVICERequest('del');
    }

    async go(pc?: number): Promise<void> {
        return Promise.resolve().
            // Answer immediately and afterwards send the "go" command.
            then(async () => {
                this.emit("continue");
                const cmd = pc === undefined ?
                    'g' : `g ${pc.toString(16)}`;
                await this.sendVICERequest(cmd, false);
            });
    }

    public async next(): Promise<void> {
        const response = await this.sendVICERequest('next', true);
        if (!response) {
            throw new Error("Cannot get response");
        } else {
            const bp = this.parseNextBreakAddr(response);
            if (!bp)
                this.echo("Error while parsing 'next' output!")
            else
                this.emit('stopOnStep', bp);
        }
    }

    public async step(): Promise<void> {
        await this.sendVICERequest('step', false);
    }

    private parseRegisters(msg: string): C64Regs | null {
        const lines = msg.split('\n').filter(m => m);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            //  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
            //.;080d 00 00 0a f3 2f 37 00100010 000 002    4147418
            const regsRe = /^(\(C:\$([0-9a-f]+)\))?\s+ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH/;
            const valsRe = /.;([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+) ([01])+ ([0-9]+) ([0-9]+)\s+([0-9]+)/
            if (line.match(regsRe)) {
                i++;
                if (i < lines.length) {
                    const line = lines[i];
                    this.echo(line);
                    const m = line.match(valsRe);
                    if (m) {
                        const vals: C64Regs = {
                            PC: parseInt(m[1], 16),
                            A: parseInt(m[2], 16),
                            X: parseInt(m[3], 16),
                            Y: parseInt(m[4], 16),
                            SP: parseInt(m[5], 16),
                            V0: parseInt(m[6], 16),
                            V1: parseInt(m[7], 16),
                            FL: parseInt(m[8], 2),
                            LN: parseInt(m[9], 10),
                            CY: parseInt(m[10], 10),
                            SW: parseInt(m[11], 10),
                        }
                        return vals;
                    }
                }
            }
        }

        return null;
    }

    public async retrieveRegisters(): Promise<C64Regs | null> {
        const response: string | null = await this.sendVICERequest('r');
        return response ? this.parseRegisters(response) : null;
    }

    async pause(): Promise<void> {
        const regs: C64Regs | null = await this.retrieveRegisters();
        if (regs) {
            this.emit('stopOnUser', regs.PC);
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.sendVICERequest('quit', false);
    }

    async disass(pc?: number): Promise<void> {
        const cmd = pc === undefined ?
            'disass' : `disass ${pc.toString(16)}`;
        await this.sendVICERequest(cmd);
    }

    async rawCommand(cmd: string): Promise<void> {
        await this.sendVICERequest(cmd);
    }

    async loadProgram(prgName: string, startAddress: number, stopOnEntry: boolean): Promise<void> {
        const addrHex = startAddress.toString(16);
        if (stopOnEntry) {
            await this.sendVICERequest(`l "${prgName}" 0 801`);
            await this.sendVICERequest(`break ${addrHex}`);
            await this.sendVICERequest(`goto ${addrHex}`, false);
            await this.sendVICERequest(`del`);
        } else {
            await this.sendVICERequest(`l "${prgName}" 0 801`);
            await this.sendVICERequest(`goto ${addrHex}`, false);
        }
    }
}

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
    return new Promise((resolve) => {
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
            });
        } catch (err) {
            throw new Error(`Cannot connect to c64jasm server: ${err}`);
        }
    });
}

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

    // CPU address when last breakpoint was hit
    private _stoppedAddr = 0;

    // maps from sourceFile to array of C64jasm breakpoints
    private _breakPoints = new Map<string, C64jasmBreakpoint[]>();

    // since we want to send breakpoint events, we will assign an id to every event
    // so that the frontend can match events with breakpoints.
    private _breakpointId = 1;

    private _monitor: MonitorConnection | undefined = undefined;
    private _debugInfo: C64jasmDebugInfo = null;

    constructor() {
        super();
    }

    private readonly debugConsoleOutput = (logMsg: string) => {
        this.sendEvent('output', logMsg);
    };

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

        let monitorPort = C64jasmRuntime.defaultMonitorPort;
        monitorPort = await getport({
            port: getport.makeRange(C64jasmRuntime.defaultMonitorPort,
                C64jasmRuntime.defaultMonitorPort + 1024),
            host: host
        });
        this._monitor = new MonitorConnection(this.debugConsoleOutput, monitorPort);

        // Handle stop on breakpoint
        this._monitor.on('break', (breakAddr) => {
            this._stoppedAddr = breakAddr;
            this.sendEvent('stopOnBreakpoint');
        });
        this._monitor.on('stopOnStep', breakAddr => {
            this._stoppedAddr = breakAddr;
            this.sendEvent('stopOnStep');
        });
        this._monitor.on('continue', () => {
            this.sendEvent('continue');
        });
        this._monitor.on('stopOnUser', breakAddr => {
            this._stoppedAddr = breakAddr;
            this.sendEvent('stopOnUser');
        });
        /* do not await */this._monitor.connect();

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
            "+binarymonitor",
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
                }
                else {
                    resolve([response.body.processId || -1, response.body.shellProcessId || -1]);
                }
            })
        });
        this.emit('output', `Launched [x64sc, pid=${vicePid}] and [shell, pid=${shellPid}]`);

        await this._monitor.waitConnectionDone();
        await this._monitor.loadProgram(program, startAddress, stopOnEntry);
        // Stop the debugger once the VICE process exits.
    }

    public async terminate(): Promise<void> {
        if (this._monitor)
            await this._monitor.dispose();
    }

    /**
     * Continue execution.
     */
    public continue(): Promise<void> {
        return this._monitor.go();
    }

    public step(): Promise<void> {
        return this._monitor.step();
    }

    public next(): Promise<void> {
        return this._monitor.next();
    }

    public pause(): Promise<void> {
        return this._monitor.pause();
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
        const pcToLoc = this._debugInfo.debugInfo.pcToLocs[addr];
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

    /**
     * Returns a stack trace for the address where we're currently stopped at.
     */
    public stack(): StackFrame | undefined {
        if (this._debugInfo && this._debugInfo.debugInfo) {
            const res = this.findSourceLineByAddr(this._stoppedAddr);
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
        return this._monitor.disass(pc);
    }

    // Disassemble from current PC
    public rawCommand(c: string) {
        return this._monitor.rawCommand(c);
    }

    public async retrieveRegisters(): Promise<C64Regs | null> {
        return await this._monitor.retrieveRegisters();
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
