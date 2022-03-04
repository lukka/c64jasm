import EventEmitter = require("events");
import * as net from 'net'
import * as utils from './utils'

export class SocketWrapper extends EventEmitter {
    private readonly opts: net.TcpSocketConnectOpts;
    private static readonly MaxRetryCount: number = 10;
    private socket: net.Socket = new net.Socket({ readable: true, writable: true });
    private disposed: boolean = false;
    private retryCount: number = 0;
    private retryingConnect: boolean = false;
    private isConnected: boolean = false;

    constructor(host: string, port: number) {
        super();
        this.opts = { port: port, host: host };
        this.socket.on('connect', this.onConnected.bind(this));
        this.socket.on('close', this.onClosed.bind(this));
        this.socket.on('error', this.onError.bind(this));
        //??this.socket.on('data', this.onData.bind(this));
        //??this.onResponse = lodash.debounce(this.onResponse.bind(this), this.debounceIncomingDataTimeout);
        this.connect();
    }

    public on = this.socket.on.bind(this.socket);
    public off = this.socket.off.bind(this.socket);
    public end = this.socket.end.bind(this.socket);
    public destroy = this.socket.destroy.bind(this.socket);

    public writeBinary(buffer: Buffer): Promise<void> {
        return new Promise((resolve, reject) =>
            this.socket.write(buffer, 'binary',
                (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                }));
    }

    public async waitConnectionDone(): Promise<void> {
        while (!this.isConnected && this.retryCount < SocketWrapper.MaxRetryCount) {
            await utils.delay(500);
        }

        if (!(this.retryCount < SocketWrapper.MaxRetryCount))
            throw new Error(`cannot connect to VICE monitor port ${this.opts.port}`);
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        this.socket.end();
    }

    private connect(): void {
        if (!this.disposed) {
            this.retryCount++;
            this.socket.connect(this.opts);
        }
    }

    /*private onData(data: Buffer) {
        const dataString: string = data.toString();
        // Ordinary income data management.
        //??this.echo(`Recv: ${dataString}`);
        console.log(dataString.toString());
        this.incomingChunks.push(data);
        //??this.onResponse();
    }*/

    private onError(err: Error) {
        this.isConnected = false;
        this.retryingConnect = false;
        console.log(`Error on connection to VICE monitor (${err})`);
    }

    private onConnected(): void {
        this.isConnected = true;
        this.retryingConnect = false;
        console.log(`Connected to VICE monitor (${this.opts.port})`);
    }

    private onClosed(): void {
        this.isConnected = false;

        console.log(`Disconnected to VICE monitor (${this.opts.port})`);
        if (!this.disposed) {
            if (!this.retryingConnect) {
                this.retryingConnect = true;
                setTimeout(() => {
                    if (!this.disposed)
                        this.connect();
                }, 500);
            }
        }
    }
};
