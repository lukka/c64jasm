import EventEmitter = require("events");
import * as net from 'net'
import * as utils from './utils'

export class SocketWrapper extends EventEmitter {
    private readonly opts: net.TcpSocketConnectOpts;
    private socket: net.Socket = new net.Socket({ readable: true, writable: true });
    private disposed: boolean = false;
    private retryingConnect: boolean = false;
    private isConnected: boolean = false;
    private abortSignal: AbortSignal | null = null;

    private retryTimeoutMs: number = 0;
    private firstDisconnectTime: number = 0;

    constructor(host: string, port: number, abortSignal?: AbortSignal, retryTimeoutMs: number = 0) {
        super();
        this.opts = { port: port, host: host };
        this.abortSignal = abortSignal || null;
        this.retryTimeoutMs = retryTimeoutMs;
        
        // Check if already aborted before connecting
        if (this.abortSignal?.aborted) {
            this.disposed = true;
            return;
        }
        
        this.setupSocket();
        this.connect();
    }

    private setupSocket() {
        this.socket = new net.Socket({ readable: true, writable: true });
        this.socket.on('connect', this.onConnected.bind(this));
        this.socket.on('close', this.onClosed.bind(this));
        this.socket.on('error', this.onError.bind(this));
        // proxy important events
        this.socket.on('data', (data) => this.emit('data', data));
        this.socket.on('end', () => this.emit('end'));
        this.socket.on('close', () => this.emit('close'));
        this.socket.on('error', (err) => this.emit('error', err));
        this.socket.on('connect', () => this.emit('connect'));
    }

    public end = () => this.socket.end();
    public destroy = () => this.socket.destroy();

    public writeBinary(buffer: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.socket.write(buffer, 'binary', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    public async waitConnectionDone(timeoutMs: number = 30000): Promise<void> {
        const startTime = Date.now();
        
        while (!this.isConnected) {
            // Check if aborted
            if (this.abortSignal?.aborted) {
                throw new Error(`Connection to port ${this.opts.port} was cancelled`);
            }
            
            // Check if disposed
            if (this.disposed) {
                throw new Error(`Connection to port ${this.opts.port} was closed`);
            }
            
            // Check timeout
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`Timeout connecting to port ${this.opts.port} after ${timeoutMs}ms`);
            }
            
            await utils.delay(500);
        }
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        this.socket.end();
    }

    private connect(): void {
        if (!this.disposed && !this.abortSignal?.aborted) {
            if (this.socket.destroyed) {
                this.socket.removeAllListeners();
                this.setupSocket();
            }
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
        if (this.disposed || this.abortSignal?.aborted) {
            return; // Ignore errors if we are shutting down
        }
        console.log(`Error on connection to VICE monitor (${err})`);
    }

    private onConnected(): void {
        this.isConnected = true;
        this.retryingConnect = false;
        this.firstDisconnectTime = 0;
        console.log(`Connected to VICE monitor (${this.opts.port})`);
    }

    private onClosed(): void {
        this.isConnected = false;

        console.log(`Disconnected from VICE monitor (${this.opts.port})`);

        if (this.disposed || this.abortSignal?.aborted) {
            return;
        }
        
        if (!this.firstDisconnectTime) {
            this.firstDisconnectTime = Date.now();
        }

        if (this.retryTimeoutMs > 0 && (Date.now() - this.firstDisconnectTime) > this.retryTimeoutMs) {
            console.log(`Giving up reconnecting to (${this.opts.port}) after ${this.retryTimeoutMs}ms limit reached.`);
            this.dispose();
            return;
        }

        if (!this.retryingConnect) {
            this.retryingConnect = true;
            setTimeout(() => {
                if (!this.disposed && !this.abortSignal?.aborted) {
                    this.retryingConnect = false;
                    this.connect();
                }
            }, 500);
        }
    }
};
