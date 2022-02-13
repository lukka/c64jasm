import * as utils from './utils'

export const HeaderReqLen = 11;
export const HeaderRespLen = 12;
export const STX = 0x2;
export const APIVER = 0x2;

export enum RequestType {
    MON_REQUEST_MEM_GET = 0x1,
    MON_REQUEST_MEM_SET = 0x2,
    MON_REQUEST_CHECKPOINT_GET = 0x11,
    MON_REQUEST_CHECKPOINT_SET = 0x12,
    MON_REQUEST_CHECKPOINT_DELETE = 0x13,
    MON_REQUEST_CHECKPOINT_LIST = 0x14,
    MON_REQUEST_CHECKPOINT_TOGGLE = 0x15,
    MON_REQUEST_CONDITION_SET = 0x22,
    MON_REQUEST_REGISTER_GET = 0x31,
    MON_REQUEST_REGISTERS_SET = 0x32,
    MON_REQUEST_DUMP = 0x41,
    MON_REQUEST_UNDUMP = 0x42,
    MON_REQUEST_ADVANCE_INSTRUCTIONS = 0x71,
    MON_REQUEST_KEYBOARD_FEED = 0x72,
    MON_REQUEST_EXECUTE_UNTIL_RETURN = 0x73,
    MON_RESQUEST_PING = 0x81,
    MON_REQUEST_BANKS_AVAILABLE = 0x82,
    MON_REQUEST_REGISTERS_AVAILABLE = 0x83,
    MON_REQUEST_DISPLAY_GET = 0x84,
    MON_REQUEST_VICE_INFO = 0x85,
    MON_REQUEST_EXIT = 0xaa,
    MON_REQUEST_QUIT = 0xbb,
    MON_REQUEST_RESET = 0xcc,
    MON_REQUEST_AUTOSTART = 0xdd
}

export const RequestTypeNames = new Map<number, string>(
    Object.entries(RequestType)
        .filter(([key, value]) => typeof value === 'number')
        .map(([key, value]) => [value as number, key])
);

export const FakeTypeMask = 0xF00;

export enum ResponseType {
    MON_RESPONSE_MEM_GET = 0x1,
    MON_RESPONSE_MEM_SET = 0x2,
    MON_RESPONSE_CHECKPOINT_INFO = 0x11,
    MON_RESPONSE_CHECKPOINT_SET = 0x12,
    MON_RESPONSE_CHECKPOINT_DELETE = 0x13,
    MON_RESPONSE_CHECKPOINT_LIST = 0x14,
    MON_FAKE_RESPONSE_CHECKPOINT_LIST = 0xF14,
    MON_RESPONSE_CHECKPOINT_TOGGLE = 0x15,
    MON_RESPONSE_CONDITION_SET = 0x22,
    MON_RESPONSE_REGISTER_INFO = 0x31,
    MON_RESPONSE_REGISTERS_SET = 0x32,
    MON_RESPONSE_JAM = 0x61,
    MON_RESPONSE_STOPPED = 0x62,
    MON_RESPONSE_RESUMED = 0x63,
    MON_RESPONSE_ADVANCE_INSTRUCTIONS = 0x71,
    MON_RESPONSE_EXECUTE_UNTIL_RETURN = 0x73,
    MON_RESPONSE_PING = 0x81,
    MON_RESPONSE_BANKS_AVAILABLE = 0x82,
    MON_RESPONSE_REGISTERS_AVAILABLE = 0x83,
    MON_RESPONSE_VICE_INFO = 0x85,
    MON_RESPONSE_EXIT = 0xaa,
    MON_RESPONSE_QUIT = 0xbb,
    MON_RESPONSE_AUTOSTART = 0xdd
}

export const ResponseTypeNames = new Map<number, string>(
    Object.entries(ResponseType)
        .filter(([key, value]) => typeof value === 'number')
        .map(([key, value]) => [value as number, key])
);

export enum ResponseCode {
    OK = 0,
    NOTFOUND = 1,
    MEMSPACE_INVALID = 2,
    LEN_INVALID = 0x80,
    PARAM_INVALID = 0x81,
    API_INVALID = 0x82,
    TYPE_INVALID = 0x83,
    GENERAL_FAILURE = 0x8f
};

export const ResponseCodeNames = new Map<number, string>(
    Object.entries(ResponseCode)
        .filter(([key, value]) => typeof value === 'number')
        .map(([key, value]) => [value as number, key])
);

export enum CPUOp {
    LOAD = 0x1,
    STORE = 0x2,
    EXEC = 0x4
}

class BufferWriter {
    private writePtr: number = 0;

    constructor(public readonly buffer: Buffer) {
    }

    public writeUInt8(value: number, offset?: number): BufferWriter {
        this.buffer.writeUInt8(value, this.writePtr);
        this.writePtr += 1;
        return this;
    }

    public writeUInt16LE(value: number): BufferWriter {
        this.buffer.writeUInt16LE(value, this.writePtr);
        this.writePtr += 2;
        return this;
    }

    public writeUInt32LE(value: number): BufferWriter {
        this.buffer.writeUInt32LE(value, this.writePtr);
        this.writePtr += 4;
        return this;
    }

    public writeString(value: string): BufferWriter {
        this.buffer.write(value, this.writePtr, value.length, "utf8");
        this.writePtr += value.length;
        return this;
    }
}

class BufferReader {
    private readPtr: number = 0;

    constructor(public readonly buffer: Buffer) {
    }

    public readUInt8(): number {
        const n = this.buffer.readUInt8(this.readPtr);
        this.readPtr += 1;
        return n;
    }

    public readUInt16LE(): number {
        const n = this.buffer.readUInt16LE(this.readPtr);
        this.readPtr += 2;
        return n;
    }

    public readUInt32LE(): number {
        const n = this.buffer.readUInt32LE(this.readPtr);
        this.readPtr += 4;
        return n;
    }

    public readString(len: number): string {
        const s = this.buffer.slice(this.readPtr, this.readPtr + len).toString("utf8");
        this.readPtr += len;
        return s;
    }

    public readBuffer(len: number): Buffer {
        const b = this.buffer.slice(this.readPtr, this.readPtr + len);
        this.readPtr += len;
        return b;
    }
}

export abstract class Request<TResponse extends Response> {
    // Location of 'id' in the buffer, byte six to nine, 32bit little endian.
    static readonly idOffset = 6;
    private header: Buffer = Buffer.alloc(HeaderReqLen);
    private body: Buffer | undefined;
    private response: TResponse | null = null;
    public id: number | null = null;
    public readonly type: RequestType;

    protected constructor(type: RequestType, body?: Buffer) {
        this.setHeader(type, body);
        this.body = body;
        this.type = type;
    }

    public getBuffer(): Buffer {
        if (this.body)
            return Buffer.concat([this.header, this.body]);
        return this.header;
    }

    public toString(limit: number = 32): string {
        const requestTypeName = RequestTypeNames.get(this.type) || "Unknown";
        let s = `id=0x${utils.toBase(this.id, 16, 2)}, type=0x${utils.toBase(this.type, 16, 2)}(${requestTypeName})`;
        s += `\t header: 0x${this.header.toString('hex').match(/../g)?.join(' 0x')}`;
        if (this.body) {
            const hexPairs = this.body.toString('hex').match(/../g) || [];
            let hexDisplay: string;
            if (hexPairs.length > limit * 2) {
                const first = hexPairs.slice(0, limit).join(' 0x');
                const last = hexPairs.slice(-limit).join(' 0x');
                hexDisplay = `0x${first} ... 0x${last}`;
            } else {
                hexDisplay = `0x${hexPairs.join(' 0x')}`;
            }
            s += `\n\t body: ${hexDisplay}`;
        }
        return s;
    }

    public tryGetResponse(): TResponse | null {
        return this.response;
    };

    public abstract createResponse(buffer: Buffer): TResponse;

    public addData(buffer: Buffer): void {
        this.setResponse(this.createResponse(buffer));
    }

    public setResponse(response: TResponse): void {
        this.response = response;
    }

    private setHeader(type: RequestType, body?: Buffer): void {
        const bw: BufferWriter = new BufferWriter(this.header);
        bw.writeUInt8(STX);
        bw.writeUInt8(APIVER);
        bw.writeUInt32LE(body ? body.length : 0);
        bw.writeUInt32LE(0);
        bw.writeUInt8(type);
    }

    public setId(id: number): void {
        this.id = id;
        this.header.writeUInt32LE(id, 6);
    }
};

export abstract class ResponseHeader {
    readonly code: ResponseCode;
    readonly id: number;
    readonly type: ResponseType;
    // Length in byte of the body, header excluded.
    readonly bodyLength: number;

    public toString(): string {
        const typeName = this.type ? ResponseTypeNames.get(this.type) : "Unknown";
        return `ResponseHeader: id=0x${utils.toBase(this.id, 16)} type=${typeName}(0x${utils.toBase(this.type, 16)}) code=0x${utils.toBase(this.code, 16)} bodyLength=${this.bodyLength}`;
    }
};

export function toString(rh: ResponseHeader): string {
    let s: string = ``;
    s += `id=0x${utils.toBase(rh.id, 16)} `;
    const responseTypeName = ResponseTypeNames.get(rh.type) || "Unknown";
    s += `type=0x${utils.toBase(rh.type, 16)}(${responseTypeName}) `;
    s += `code=0x${utils.toBase(rh.code, 16)}`;
    return s;
}

export abstract class Response {
    public readonly header: ResponseHeader;
    // The RequestType the raw data must match.
    public abstract Type(): ResponseType;
    public static readonly Type: ResponseType;
    public readonly body: Buffer | null = null;

    protected constructor(buffer: Buffer) {
        if (this.Type() && (this.Type() & FakeTypeMask) === FakeTypeMask)
            return;
        this.header = Response.parseHeader(buffer);

        // If the response contains an error code, skip type and body length validation
        // as VICE may return a generic error response with type=0 and empty body
        if (this.header.code === ResponseCode.OK) {
            if (this.header.type != this.Type())
                throw new Error(`Type '${this.header.type.toString()}' is not the expected '${this.Type().toString()}'.`);
            this.body = buffer.slice(HeaderRespLen);
            if (this.header.bodyLength !== this.body.length)
                throw new Error(`Size of input buffer is unexpected for type ${this.header.type}: ${this.header.bodyLength}`);
        } else {
            // For error responses, still extract the body if present
            this.body = buffer.slice(HeaderRespLen);
        }
    }

    /**
     * Returns true if the response contains an error code (non-zero code).
     */
    public isError(): boolean {
        return this.header && this.header.code !== ResponseCode.OK;
    }

    /**
     * Returns the error code from the response header.
     */
    public getErrorCode(): ResponseCode {
        return this.header ? this.header.code : ResponseCode.GENERAL_FAILURE;
    }

    /**
     * Returns the name of the error code.
     */
    public getErrorName(): string {
        const code = this.getErrorCode();
        return ResponseCodeNames.get(code) || `UNKNOWN_ERROR_${code}`;
    }

    /**
     * Returns a human-readable error message.
     */
    public getErrorMessage(): string {
        if (!this.isError()) {
            return "No error";
        }
        const errorName = this.getErrorName();
        const code = this.getErrorCode();
        return `${errorName} (0x${utils.toBase(code, 16)})`;
    }

    /**
     * Throws an error if the response contains an error code.
     * Use this when you want to fail fast on errors.
     */
    public throwIfError(): void {
        if (this.isError()) {
            throw new Error(`VICE monitor error: ${this.getErrorMessage()}`);
        }
    }

    public static parseHeader(buffer: Buffer): ResponseHeader {
        const br: BufferReader = new BufferReader(buffer);
        const stx = br.readUInt8();
        if (stx !== STX)
            throw new Error(`not a response, STX!=${STX} (buffer=${buffer.toString('hex')})`);

        const API = br.readUInt8();
        if (API !== APIVER)
            throw new Error(`not a response, API!=${APIVER} (buffer=${buffer.toString('hex')})`);

        const bodyLen = br.readUInt32LE();
        if (bodyLen > br.buffer.length - HeaderRespLen)
            throw new Error(`not a response, LEN overflows (bodyLen=${bodyLen}, bufferLen=${br.buffer.length})`);

        const type = br.readUInt8() as ResponseType;
        const code: ResponseCode = br.readUInt8() as ResponseCode;
        const id: number = br.readUInt32LE();
        return {
            type: type,
            code: code,
            id: id,
            bodyLength: bodyLen
        } as ResponseHeader;
    }

    public toString(limit: number = 32): string {
        if (this.header) {
            const responseTypeName = ResponseTypeNames.get(this.header.type) ?? "Unknown";
            let s: string = `Response: header: type=0x${utils.toBase(this.header.type, 16, 2)}(${responseTypeName}) id=0x${utils.toBase(this.header.id, 16, 2)} code=0x${utils.toBase(this.header.code, 16, 2)}}`;
            if (this.body) {
                const hexPairs = this.body.toString('hex').match(/../g) || [];
                let hexDisplay: string;
                if (hexPairs.length > limit * 2) {
                    const first = hexPairs.slice(0, limit).join(' 0x');
                    const last = hexPairs.slice(-limit).join(' 0x');
                    hexDisplay = `0x${first} ... 0x${last}`;
                } else {
                    hexDisplay = `0x${hexPairs.join(' 0x') ?? "<empty>"}`;
                }
                s += `\n\t body: ${hexDisplay}`;
            }
            return s;
        } else if (this.Type()) {
            return `Response of type ${ResponseTypeNames.get(this.Type())}(0x${utils.toBase(this.Type(), 16, 2)})`;
        }
        return `Response of unknown type`;
    }
};

export class MemoryGetRequest extends Request<MemoryGetResponse> {
    constructor(id: number, start: number, end: number, bankId: number) {
        const bw = new BufferWriter(Buffer.alloc(8));
        bw.writeUInt8(0);
        bw.writeUInt16LE(start);
        bw.writeUInt16LE(end);
        bw.writeUInt8(0);
        bw.writeUInt16LE(bankId);

        super(RequestType.MON_REQUEST_MEM_GET, bw.buffer);
    }

    public createResponse(buffer: Buffer): MemoryGetResponse {
        return new MemoryGetResponse(buffer);
    }
};

export class MemoryGetResponse extends Response {
    public readonly memory: Buffer;
    constructor(buffer: Buffer) {
        super(buffer);
        const br = new BufferReader(buffer.slice(HeaderRespLen));
        const len = br.readUInt16LE();
        this.memory = br.readBuffer(len);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_MEM_GET; }
};

export class MemorySetRequest extends Request<MemorySetResponse> {
    constructor(start: number, end: number, bankId: number, memory: Buffer) {
        const bw = new BufferWriter(Buffer.alloc(8 + memory.length));
        bw.writeUInt8(0); // Side effects: 0 = no side effects
        bw.writeUInt16LE(start);
        bw.writeUInt16LE(end);
        bw.writeUInt8(0); // Memory space: 0 = main memory
        bw.writeUInt16LE(bankId);
        // Write the memory data
        for (let i = 0; i < memory.length; i++) {
            bw.writeUInt8(memory[i]);
        }

        super(RequestType.MON_REQUEST_MEM_SET, bw.buffer);
    }

    public createResponse(buffer: Buffer): MemorySetResponse {
        return new MemorySetResponse(buffer);
    }
};

export class MemorySetResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_MEM_SET; }
};

export class StepInRequest extends Request<StepInResponse> {
    constructor() {
        const bw = new BufferWriter(Buffer.alloc(3));
        bw.writeUInt8(0);//skip 0 instructions - step into subroutines.
        bw.writeUInt16LE(1);//one instruction.
        super(RequestType.MON_REQUEST_ADVANCE_INSTRUCTIONS, bw.buffer);
    }

    public createResponse(buffer: Buffer): StepInResponse {
        return new StepInResponse(buffer);
    }
};

export class StepInResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_ADVANCE_INSTRUCTIONS; }
};

export class StepOverRequest extends Request<StepOverResponse> {
    constructor() {
        const bw = new BufferWriter(Buffer.alloc(3));
        bw.writeUInt8(1);//skip 1 instruction - step over subroutines.
        bw.writeUInt16LE(1);//one instruction.
        super(RequestType.MON_REQUEST_ADVANCE_INSTRUCTIONS, bw.buffer);
    }

    public createResponse(buffer: Buffer): StepOverResponse {
        return new StepOverResponse(buffer);
    }
};

export class StepOverResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_ADVANCE_INSTRUCTIONS; }
};

export class StepOutRequest extends Request<StepOutResponse> {
    constructor() {
        super(RequestType.MON_REQUEST_EXECUTE_UNTIL_RETURN);
    }

    public createResponse(buffer: Buffer): StepOutResponse {
        return new StepOutResponse(buffer);
    }
};

export class StepOutResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_EXECUTE_UNTIL_RETURN; }
};

export class ContinueRequest extends Request<ContinueResponse> {
    constructor() {
        super(RequestType.MON_REQUEST_EXIT);
    }

    public createResponse(buffer: Buffer): ContinueResponse {
        return new ContinueResponse(buffer);
    }
};

export class ContinueResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_EXIT; }
};

export class RegistersGetRequest extends Request<RegistersGetResponse> {
    constructor() {
        const b = Buffer.alloc(1);
        b.writeUInt8(0);//main memory
        super(RequestType.MON_REQUEST_REGISTER_GET, b);
    }

    public createResponse(buffer: Buffer): RegistersGetResponse {
        return new RegistersGetResponse(buffer);
    }
};

export class RegistersGetResponse extends Response {
    public readonly regs: { [id: number]: { value: number } } = {};
    constructor(buffer: Buffer) {
        super(buffer);
        // Read and eat until the first item.
        const n = buffer.readUInt16LE(HeaderRespLen);
        buffer = buffer.slice(HeaderRespLen + 2);

        for (let i = 0; i < n; i++) {
            const br = new BufferReader(buffer);
            const itemSize: number = br.readUInt8();
            const id: number = br.readUInt8();
            const value: number = br.readUInt16LE();
            this.regs[id] = { value };

            buffer = buffer.slice(itemSize + 1);
        }
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_REGISTER_INFO; }
};

export class RegistersAvailRequest extends Request<RegistersAvailResponse> {
    constructor() {
        const b = Buffer.alloc(1);
        b.writeUInt8(0);//main memory
        super(RequestType.MON_REQUEST_REGISTERS_AVAILABLE, b);
    }

    public createResponse(buffer: Buffer): RegistersAvailResponse {
        return new RegistersAvailResponse(buffer);
    }
};

export class RegistersAvailResponse extends Response {
    public readonly map: { [id: number]: { name: string, byteCount: number } } = {};
    constructor(buffer: Buffer) {
        super(buffer);
        // Read and eat until the first item.
        const n = buffer.readUInt16LE(HeaderRespLen);
        buffer = buffer.slice(HeaderRespLen + 2);

        for (let i = 0; i < n; i++) {
            const br = new BufferReader(buffer);
            const itemSize: number = br.readUInt8();
            const id: number = br.readUInt8();
            const size: number = br.readUInt8();
            const len: number = br.readUInt8();
            const name: string = br.readString(len);
            this.map[id] = {
                name: name,
                byteCount: size / 8 // bit-count to byte-count conversion.
            };

            buffer = buffer.slice(itemSize + 1);
        }
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_REGISTERS_AVAILABLE; }
};

export class RegistersSetRequest extends Request<RegistersSetResponse> {
    constructor(registerId: number, value: number) {
        const bw = new BufferWriter(Buffer.alloc(7));
        bw.writeUInt8(0); // memspace: 0x00 = main memory
        bw.writeUInt16LE(1); // count: one item
        bw.writeUInt8(3); // item size (excluding this byte): 1 byte ID + 2 bytes value
        bw.writeUInt8(registerId); // register ID
        bw.writeUInt16LE(value); // register value (16-bit little endian)
        super(RequestType.MON_REQUEST_REGISTERS_SET, bw.buffer);
    }

    public createResponse(buffer: Buffer): RegistersSetResponse {
        return new RegistersSetResponse(buffer);
    }
}

export class RegistersSetResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_REGISTER_INFO; }
}

export class VICEInfoGetRequest extends Request<VICEInfoGetResponse> {
    constructor() {
        super(RequestType.MON_REQUEST_VICE_INFO);
    }

    public createResponse(buffer: Buffer): VICEInfoGetResponse {
        return new VICEInfoGetResponse(buffer);
    }
};

export class VICEInfoGetResponse extends Response {
    public readonly info: { version: string, svn: string };
    constructor(buffer: Buffer) {
        super(buffer);
        const br = new BufferReader(buffer.slice(HeaderRespLen));
        const len = br.readUInt8();
        let vers: string[] = [];
        for (let i = 0; i < len; i++) {
            vers.push(br.readUInt8().toString());
        }
        const ver = vers.join('.');
        const lenSVN = br.readUInt8();
        const svnCommit = br.readString(lenSVN);
        this.info = { version: ver, svn: svnCommit };
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_VICE_INFO; }
};

export class BankGetRequest extends Request<BankGetResponse> {
    constructor() {
        super(RequestType.MON_REQUEST_BANKS_AVAILABLE);
    }

    public createResponse(buffer: Buffer): BankGetResponse {
        return new BankGetResponse(buffer);
    }
};

export class BankGetResponse extends Response {
    public readonly banks: Bank[] = [];

    public constructor(buffer: Buffer) {
        super(buffer);
        // Read and eat until the first item.
        const n = buffer.readUInt16LE(HeaderRespLen);
        buffer = buffer.slice(HeaderRespLen + 2);

        for (let i = 0; i < n; i++) {
            const br = new BufferReader(buffer);
            const sz: number = br.readUInt8();
            const id: number = br.readUInt16LE();
            const len: number = br.readUInt8();
            const name = br.readString(len);
            this.banks.push({ id: id, name: name });

            buffer = buffer.slice(sz + 1);
        }
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_BANKS_AVAILABLE; }
};

export interface Bank {
    id: number;
    name: string
}

export class StoppedResponse extends Response {
    public readonly pc: number;
    constructor(buffer: Buffer) {
        super(buffer);
        this.pc = buffer.slice(HeaderRespLen).readUInt16LE();
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_STOPPED; }
};

export class ResumedResponse extends Response {
    public readonly pc: number;
    constructor(buffer: Buffer) {
        super(buffer);
        this.pc = buffer.slice(HeaderRespLen).readUInt16LE();
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_RESUMED; }
};

export class JamResponse extends Response {
    public readonly pc: number;
    constructor(buffer: Buffer) {
        super(buffer);
        this.pc = buffer.slice(HeaderRespLen).readUInt16LE();
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_JAM; }
};

export class QuitRequest extends Request<QuitResponse> {
    constructor() {
        super(RequestType.MON_REQUEST_QUIT);
    }

    public createResponse(buffer: Buffer): QuitResponse {
        return new QuitResponse(buffer);
    }
};

export class QuitResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_QUIT; }
};

export class AutoStartRequest extends Request<AutoStartResponse> {
    constructor(file: string, run: boolean) {
        const bw = new BufferWriter(Buffer.alloc(file.length + 4));
        bw.writeUInt8(run ? 0x1 : 0x0);//Byte 0: run on load
        bw.writeUInt16LE(0);//Byte 1 and 2: file index
        bw.writeUInt8(file.length);//Byte 3: file length
        bw.writeString(file);

        super(RequestType.MON_REQUEST_AUTOSTART, bw.buffer);
    }

    public createResponse(buffer: Buffer): AutoStartResponse {
        return new AutoStartResponse(buffer);
    }
};

export class AutoStartResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_AUTOSTART; }
};

export class CheckpointListRequest extends Request<CheckpointListFakeResponse> {
    private ids: number[] = [];
    private count: number;
    constructor() {
        super(RequestType.MON_REQUEST_CHECKPOINT_LIST);
    }

    public override addData(buffer: Buffer): void {
        //?? TODO: accumulate chunks?
        try {
            const c: CheckpointResponse = new CheckpointResponse(buffer);
            this.ids.push(c.checkpointId);
            console.log(`Received checkpoint: ${c.toString()}`);
        } catch (e) {
        }

        try {
            const c: CheckpointListResponse = new CheckpointListResponse(buffer);
            this.count = c.checkpointCount;
            console.log(`Received checkpoint count: ${c.toString()}`);

            const c2: CheckpointListFakeResponse = new CheckpointListFakeResponse(this.ids, this.count);
            this.setResponse(c2);
        } catch (e) {
        }
    }

    public createResponse(buffer: Buffer): CheckpointListFakeResponse {
        throw "Not implemented";
    }

    public override toString(): string {
        var superToString = super.toString();
        return `${superToString} ids=[${this.ids.join(', ')}] count=${this.count}`;
    }
};

export class CheckpointListResponse extends Response {
    public readonly checkpointCount: number = 0;
    constructor(buffer: Buffer) {
        super(buffer);
        const br = new BufferReader(buffer.slice(HeaderRespLen));
        this.checkpointCount = br.readUInt16LE();
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_CHECKPOINT_LIST; }

    public override toString(): string {
        var superToString = super.toString();
        return `${superToString} checkpointCount=${this.checkpointCount}`;
    }
};

export class CheckpointListFakeResponse extends Response {
    public readonly checkpointIds: number[] = [];
    public readonly checkpointCount: number;
    constructor(ids: number[], count: number) {
        super(Buffer.alloc(0));
        this.checkpointIds = ids;
        this.checkpointCount = count;
    }

    public override Type(): ResponseType { return ResponseType.MON_FAKE_RESPONSE_CHECKPOINT_LIST; }
};

export class CheckpointSetRequest extends Request<CheckpointResponse> {
    constructor(start: number, end: number, stop: boolean, enabled: boolean, op: CPUOp, temp: boolean) {
        const bw = new BufferWriter(Buffer.alloc(9));
        bw.writeUInt16LE(start);
        bw.writeUInt16LE(end);
        bw.writeUInt8(stop ? 1 : 0);
        bw.writeUInt8(enabled ? 1 : 0);
        bw.writeUInt8(op);
        bw.writeUInt8(temp ? 1 : 0);
        bw.writeUInt8(0);//main mem space.
        super(RequestType.MON_REQUEST_CHECKPOINT_SET, bw.buffer);
    }

    public createResponse(buffer: Buffer): CheckpointResponse {
        return new CheckpointResponse(buffer);
    }
};

export class CheckpointResponse extends Response {
    public readonly checkpointId: number;
    public readonly hit: boolean;
    public readonly start: number;
    public readonly end: number;
    public readonly stopWhenHit: boolean;
    public readonly enabled: boolean;
    public readonly cpuOp: CPUOp;
    public readonly temp: boolean;
    public readonly hitCount: number;
    public readonly ignoreCount: number;
    public readonly hasCondition: boolean;
    public readonly memSpace: number;

    constructor(buffer: Buffer) {
        super(buffer);
        const br = new BufferReader(buffer.slice(HeaderRespLen));
        this.checkpointId = br.readUInt32LE();
        this.hit = br.readUInt8() === 0x1;
        this.start = br.readUInt16LE();
        this.end = br.readUInt16LE();
        this.stopWhenHit = br.readUInt8() === 0x1;
        this.enabled = br.readUInt8() === 0x1;
        this.cpuOp = br.readUInt8() as CPUOp;
        this.temp = br.readUInt8() === 0x0;
        this.hitCount = br.readUInt32LE();
        this.ignoreCount = br.readUInt32LE();
        this.hasCondition = br.readUInt8() === 0x1;
        this.memSpace = br.readUInt8();
    }
    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_CHECKPOINT_INFO; }
};

export class CheckpointDeleteRequest extends Request<CheckpointDeleteResponse> {
    constructor(checkpointId: number) {
        const bw = new BufferWriter(Buffer.alloc(4));
        bw.writeUInt32LE(checkpointId);
        super(RequestType.MON_REQUEST_CHECKPOINT_DELETE, bw.buffer);
    }

    public createResponse(buffer: Buffer): CheckpointDeleteResponse {
        return new CheckpointDeleteResponse(buffer);
    }
};

export class CheckpointDeleteResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }
    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_CHECKPOINT_DELETE; }
};

export class CheckpointToggleRequest extends Request<CheckpointDeleteResponse> {
    constructor(checkpointId: number, enabled: boolean) {
        const bw = new BufferWriter(Buffer.alloc(5));
        bw.writeUInt32LE(checkpointId);
        bw.writeUInt8(enabled ? 1 : 0);
        super(RequestType.MON_REQUEST_CHECKPOINT_TOGGLE, bw.buffer);
    }

    public createResponse(buffer: Buffer): CheckpointToggleResponse {
        return new CheckpointToggleResponse(buffer);
    }
};

export class CheckpointToggleResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }
    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_CHECKPOINT_TOGGLE; }
};

export class ConditionSetRequest extends Request<ConditionSetResponse> {
    constructor(checkpointId: number, condition: string) {
        const conditionBuffer = Buffer.from(condition, 'utf8');
        const bw = new BufferWriter(Buffer.alloc(5 + conditionBuffer.length));
        bw.writeUInt32LE(checkpointId);
        bw.writeUInt8(conditionBuffer.length);
        conditionBuffer.copy(bw.buffer, 5);
        super(RequestType.MON_REQUEST_CONDITION_SET, bw.buffer);
    }

    public createResponse(buffer: Buffer): ConditionSetResponse {
        return new ConditionSetResponse(buffer);
    }
};

export class ConditionSetResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }
    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_CONDITION_SET; }
};

export class PingRequest extends Request<PingResponse> {
    constructor() {
        super(RequestType.MON_RESQUEST_PING);
    }

    public createResponse(buffer: Buffer): PingResponse {
        return new PingResponse(buffer);
    }
};

export class PingResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): ResponseType { return ResponseType.MON_RESPONSE_PING; }
};
