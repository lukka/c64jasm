import * as utils from './utils'

export const HeaderReqLen = 11;
export const HeaderRespLen = 12;
export const STX = 0x2;
export const APIVER = 0x2;

export enum RequestType {
    MON_RESPONSE_MEM_GET = 0x1,
    MON_RESPONSE_CHECKPOINT_INFO = 0x11,
    MON_RESPONSE_CHECKPOINT_SET = 0x12,
    MON_RESPONSE_CHECKPOINT_DELETE = 0x13,
    MON_RESPONSE_CHECKPOINT_LIST = 0x14,
    MON_RESPONSE_CHECKPOINT_TOGGLE = 0x15,
    MON_RESPONSE_CONDITION_SET = 0x22,
    MON_RESPONSE_REGISTER_INFO = 0x31,
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
};

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
        else
            return this.header;
    }

    public toString(): string {
        let s = `id=0x${utils.toBase(this.id, 16, 2)}, type=0x${utils.toBase(this.type, 16, 2)}`;
        s += `\t header: 0x${this.header.toString('hex').match(/../g)?.join(' 0x')}`;
        if (this.body) s += `\n\t body: 0x${this.body.toString('hex').match(/../g)?.join(' 0x')}`
        return s;
    }

    public getResponse(): TResponse | null {
        return this.response;
    };

    public abstract createResponse(buffer: Buffer): TResponse;

    public setResponse(buffer: Buffer): void {
        this.response = this.createResponse(buffer);
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

/*//??function createResponse<TResponse extends Response>(buffer: Buffer): TResponse {
    return new TResponse(buffer);
}*/

export interface ResponseHeader {
    readonly code: ResponseCode;
    readonly id: number;
    readonly type: RequestType;
    // Length in byte of the body, header excluded.
    readonly bodyLength: number;
};

export function toString(rh: ResponseHeader): string {
    let s: string = ``;
    s += `id=0x${utils.toBase(rh.id, 16)} `;
    s += `type=0x${utils.toBase(rh.type, 16)} `;
    s += `code=0x${utils.toBase(rh.code, 16)}`;
    return s;
}

export abstract class Response {
    public readonly header: ResponseHeader;
    // The RequestType the raw data must match.
    public abstract Type(): RequestType;
    public static readonly Type: RequestType;
    public readonly body: Buffer | null = null;

    protected constructor(buffer: Buffer) {
        this.header = Response.parseHeader(buffer);
        if (this.header.type != this.Type())
            throw new Error(`Type '${this.header.type.toString()}' is not the expected '${this.Type().toString()}'.`);
        this.body = buffer.slice(HeaderRespLen);
        if (this.header.bodyLength !== this.body.length)
            throw new Error(`Size of input buffer is unexpected for type ${this.header.type}: ${this.header.bodyLength}`);
    }

    public static parseHeader(buffer: Buffer): ResponseHeader {
        const br: BufferReader = new BufferReader(buffer);
        const stx = br.readUInt8();
        if (stx !== STX)
            throw new Error(`not a response, STX!=${STX} (${this.toString()})`);

        const API = br.readUInt8();
        if (API !== APIVER)
            throw new Error(`not a response, API!=${APIVER} (${this.toString()})`);

        const bodyLen = br.readUInt32LE();
        if (bodyLen > br.buffer.length - HeaderRespLen)
            throw new Error(`not a response, LEN overflows (${this.toString()})`);

        const type = br.readUInt8() as RequestType;

        const code: ResponseCode = br.readUInt8() as ResponseCode;
        const id: number = br.readUInt32LE();
        return {
            type: type,
            code: code,
            id: id,
            bodyLength: bodyLen
        } as ResponseHeader;
    }

    public toString(): string {
        let s: string = `header: type=0x${utils.toBase(this.header.type, 16, 2)} id=0x${utils.toBase(this.header.id, 16, 2)} code=0x${utils.toBase(this.header.code, 16, 2)}}`;
        if (this.body) s += `\n\t body: 0x${this.body.toString('hex').match(/../g)?.join(' 0x')}`
        return s;
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

        super(RequestType.MON_RESPONSE_MEM_GET, bw.buffer);
    }

    public createResponse(buffer: Buffer): MemoryGetResponse {
        return new MemoryGetResponse(buffer);
    }
};

export class MemoryGetResponse extends Response {
    public readonly memory: Buffer;
    constructor(buffer: Buffer) {
        super(buffer);
        const br = new BufferReader(buffer.slice(HeaderReqLen));
        const len = br.readUInt16LE();
        this.memory = br.readBuffer(len);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_MEM_GET; }
};

export class StepInRequest extends Request<StepInResponse> {
    constructor() {
        const bw = new BufferWriter(Buffer.alloc(3));
        bw.writeUInt8(1);//step in subroutines.
        bw.writeUInt16LE(1);//one instruction.
        super(RequestType.MON_RESPONSE_ADVANCE_INSTRUCTIONS, bw.buffer);
    }

    public createResponse(buffer: Buffer): StepInResponse {
        return new StepInResponse(buffer);
    }
};

export class StepInResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_ADVANCE_INSTRUCTIONS; }
};

export class StepOverRequest extends Request<StepOverResponse> {
    constructor() {
        const bw = new BufferWriter(Buffer.alloc(3));
        bw.writeUInt8(0);//do not step in subroutines.
        bw.writeUInt16LE(1);//one instruction.
        super(RequestType.MON_RESPONSE_ADVANCE_INSTRUCTIONS, bw.buffer);
    }

    public createResponse(buffer: Buffer): StepOverResponse {
        return new StepOverResponse(buffer);
    }
};

export class StepOverResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_ADVANCE_INSTRUCTIONS; }
};

export class StepOutRequest extends Request<StepOutResponse> {
    constructor() {
        super(RequestType.MON_RESPONSE_EXECUTE_UNTIL_RETURN);
    }

    public createResponse(buffer: Buffer): StepOutResponse {
        return new StepOutResponse(buffer);
    }
};

export class StepOutResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_EXECUTE_UNTIL_RETURN; }
};

export class ContinueRequest extends Request<ContinueResponse> {
    constructor() {
        super(RequestType.MON_RESPONSE_EXIT);
    }

    public createResponse(buffer: Buffer): ContinueResponse {
        return new ContinueResponse(buffer);
    }
};

export class ContinueResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_EXIT; }
};

export class RegistersGetRequest extends Request<RegistersGetResponse> {
    constructor() {
        const b = Buffer.alloc(1);
        b.writeUInt8(0);//main memory
        super(RequestType.MON_RESPONSE_REGISTER_INFO, b);
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

    public override Type(): RequestType { return RequestType.MON_RESPONSE_REGISTER_INFO; }
};

export class RegistersAvailRequest extends Request<RegistersAvailResponse> {
    constructor() {
        const b = Buffer.alloc(1);
        b.writeUInt8(0);//main memory
        super(RequestType.MON_RESPONSE_REGISTERS_AVAILABLE, b);
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

    public override Type(): RequestType { return RequestType.MON_RESPONSE_REGISTERS_AVAILABLE; }
};

/*export class RegistersSetRequest extends Request {
    constructor(id: number, value: number) {
        const b = Buffer.alloc(7);
        const bw = new BufferWriter(b);
        bw.writeUInt8(0);//main memory
        bw.writeUInt16LE(1);//one item
        bw.writeUInt8(3);//item size
        bw.writeUInt8(id);
        bw.writeUInt16LE(value);
        super(RequestType.RegistersSet, id, b);
    }
};*/

export class VICEInfoGetRequest extends Request<VICEInfoGetResponse> {
    constructor() {
        super(RequestType.MON_RESPONSE_VICE_INFO);
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

    public override Type(): RequestType { return RequestType.MON_RESPONSE_VICE_INFO; }
};

export class BankGetRequest extends Request<BankGetResponse> {
    constructor() {
        super(RequestType.MON_RESPONSE_BANKS_AVAILABLE);
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

    public override Type(): RequestType { return RequestType.MON_RESPONSE_BANKS_AVAILABLE; }
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

    public override Type(): RequestType { return RequestType.MON_RESPONSE_STOPPED; }
};

export class ResumedResponse extends Response {
    public readonly pc: number;
    constructor(buffer: Buffer) {
        super(buffer);
        this.pc = buffer.slice(HeaderRespLen).readUInt16LE();
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_RESUMED; }
};

export class JamResponse extends Response {
    public readonly pc: number;
    constructor(buffer: Buffer) {
        super(buffer);
        this.pc = buffer.slice(HeaderRespLen).readUInt16LE();
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_JAM; }
};

export class QuitRequest extends Request<QuitResponse> {
    constructor() {
        super(RequestType.MON_RESPONSE_QUIT);
    }

    public createResponse(buffer: Buffer): QuitResponse {
        return new QuitResponse(buffer);
    }
};

export class QuitResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_QUIT; }
};

export class AutoStartRequest extends Request<AutoStartResponse> {
    constructor(file: string, run: boolean) {
        const bw = new BufferWriter(Buffer.alloc(file.length + 4));
        bw.writeUInt8(run ? 0x1 : 0x0);//Byte 0: run on load
        bw.writeUInt16LE(0);//Byte 1 and 2: file index
        bw.writeUInt8(file.length);//Byte 3: file length
        bw.writeString(file);

        super(RequestType.MON_RESPONSE_AUTOSTART, bw.buffer);
    }

    public createResponse(buffer: Buffer): AutoStartResponse {
        return new AutoStartResponse(buffer);
    }
};

export class AutoStartResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_AUTOSTART; }
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
        super(RequestType.MON_RESPONSE_CHECKPOINT_SET, bw.buffer);
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
        const br = new BufferReader(buffer.slice(HeaderReqLen));
        this.checkpointId = br.readUInt16LE();
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
    public override Type(): RequestType { return RequestType.MON_RESPONSE_CHECKPOINT_INFO; }
};

export class CheckpointDeleteRequest extends Request<CheckpointDeleteResponse> {
    constructor(checkpointId: number) {
        const bw = new BufferWriter(Buffer.alloc(4));
        bw.writeUInt32LE(checkpointId);
        super(RequestType.MON_RESPONSE_CHECKPOINT_DELETE, bw.buffer);
    }

    public createResponse(buffer: Buffer): CheckpointDeleteResponse {
        return new CheckpointDeleteResponse(buffer);
    }
};

export class CheckpointDeleteResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }
    public override Type(): RequestType { return RequestType.MON_RESPONSE_CHECKPOINT_DELETE; }
};

export class CheckpointToggleRequest extends Request<CheckpointDeleteResponse> {
    constructor(checkpointId: number, enabled: boolean) {
        const bw = new BufferWriter(Buffer.alloc(5));
        bw.writeUInt32LE(checkpointId);
        bw.writeUInt8(enabled ? 1 : 0);
        super(RequestType.MON_RESPONSE_CHECKPOINT_TOGGLE, bw.buffer);
    }

    public createResponse(buffer: Buffer): CheckpointToggleResponse {
        return new CheckpointToggleResponse(buffer);
    }
};

export class CheckpointToggleResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }
    public override Type(): RequestType { return RequestType.MON_RESPONSE_CHECKPOINT_TOGGLE; }
};

export class PingRequest extends Request<PingResponse> {
    constructor() {
        super(RequestType.MON_RESPONSE_PING);
    }

    public createResponse(buffer: Buffer): PingResponse {
        return new PingResponse(buffer);
    }
};

export class PingResponse extends Response {
    constructor(buffer: Buffer) {
        super(buffer);
    }

    public override Type(): RequestType { return RequestType.MON_RESPONSE_PING; }
};
