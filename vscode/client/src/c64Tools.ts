// Copyright (c) 2025-2026 Luca Cappa All rights reserved

// Shared by the VS Code and standalone MCP backends.
import { C64jasmRuntime, C64Regs } from './c64jasmRuntime';
import { writePng } from './writePng';
import { c64Palette } from './c64Palette';

export type C64ToolContent =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: 'image/png' };

export interface C64ToolResult {
    content: C64ToolContent[];
    isError?: boolean;
}

export interface C64ToolHost {
    requireRuntime(): C64jasmRuntime;
    log(message: string): void;
    saveScreenshot?(png: Buffer, width: number, height: number): Promise<Record<string, unknown>>;
}

export const textResult = (text: string): C64ToolResult => ({ content: [{ type: 'text', text }] });
export const errorResult = (error: unknown): C64ToolResult => ({
    ...textResult(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })),
    isError: true
});
const imagePart = (png: Buffer): C64ToolContent => ({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });

const VIC_BASE = 0xD000, VIC_END = 0xD02E;
const SID_BASE = 0xD400, SID_END = 0xD418;
const CIA1_BASE = 0xDC00, CIA1_END = 0xDC0F;
const CIA2_BASE = 0xDD00, CIA2_END = 0xDD0F;
const COLOR_RAM_BASE = 0xD800, COLOR_RAM_SIZE = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

const hexToBytes = (h: string): number[] => Array.from(Buffer.from(h, 'hex'));
const hexPad = (v: number, pad: number): string => v.toString(16).toUpperCase().padStart(pad, '0');
const hex4 = (v: number): string => `0x${hexPad(v, 4)}`;

/**
 * Parses an address. The base is fixed by the JS type, which keeps the
 * contract unambiguous and internally consistent (no content sniffing):
 *   - number -> decimal value, e.g. 53280
 *   - string -> hex, with an optional "$" or "0x"/"0X" prefix,
 *               e.g. "$D020", "0xD020", "D020"
 * Returns undefined for undefined/null input; throws on a malformed string, a
 * non-integer number, or an address outside the 16-bit (0-65535) range.
 */
function parseAddress(v: number | string | undefined): number | undefined {
    if (v === undefined || v === null) return undefined;
    let n: number;
    if (typeof v === 'number') {
        if (!Number.isInteger(v)) {
            throw new Error(`Invalid address: ${v} is not an integer.`);
        }
        n = v;
    } else {
        const body = v.trim().replace(/^(\$|0x)/i, '');
        if (!/^[0-9a-f]+$/i.test(body)) {
            throw new Error(`Invalid address '${v}': expected a decimal integer (e.g. 53280) or a hex string (e.g. "$D020" or "0xD020").`);
        }
        n = parseInt(body, 16);
    }
    if (n < 0 || n > 0xFFFF) {
        throw new Error(`Address out of range: ${v} (must be 0-65535 / 0x0000-0xFFFF).`);
    }
    return n;
}

/**
 * Resolves a memory target — given as an `address` (number or hex string), a
 * `symbol` name, or a `filePath` + `line` — to a single 16-bit address.
 * `address` is normalised/validated via parseAddress; symbol and source-line
 * targets are looked up in the compiler's debug info. Throws a descriptive
 * error if the target is missing or cannot be resolved.
 */
function resolveTargetAddress(
    rt: C64jasmRuntime,
    i: { address?: number | string; symbol?: string; filePath?: string; line?: number }
): number {
    const addr = parseAddress(i.address);
    if (addr !== undefined) {
        return addr;
    }
    if (i.symbol) {
        const sym = rt.lookupSymbol(i.symbol);
        if (sym && sym.addr !== undefined) {
            return sym.addr;
        }
        throw new Error(`Symbol '${i.symbol}' not found`);
    }
    if (i.filePath && i.line) {
        const a = rt.findAddressBySourceLine(i.filePath, i.line);
        if (a !== null) {
            return a;
        }
        throw new Error(`Could not resolve address for ${i.filePath}:${i.line}`);
    }
    throw new Error("Provide a target: address, symbol, or filePath+line.");
}

function formatRegs(regs: C64Regs | null): Record<string, string> {
    if (!regs) return {};
    return Object.values(regs).reduce((acc, r) => {
        acc[r.name] = `0x${hexPad(r.value, r.byteCount * 2)}`;
        return acc;
    }, {} as Record<string, string>);
}

export interface GetRuntimeC64MemoryInput {
    cpu?: boolean;
    vic?: boolean;
    sid?: boolean;
    cia?: boolean;
    cpuHistoryCount?: number;
    memory?: { start: number | string; end?: number | string }[];
    symbols?: string[];
    screenshot?: boolean;
    spriteImages?: boolean;
}

export class GetRuntimeC64MemoryTool {
    constructor(private readonly host: C64ToolHost) {}

    async invoke(input: GetRuntimeC64MemoryInput): Promise<C64ToolResult> {
        this.host.log(`[Tool] c64jasm_getRuntimeC64Memory invoked: ${JSON.stringify(input)}`);

        try { this.host.requireRuntime(); } catch (e) {
            this.host.log(`[Tool ERROR] c64jasm_getRuntimeC64Memory: ${String(e instanceof Error ? e.message : e)}`);
            return errorResult(e);
        }

        const i = input;
        const all = !i.cpu && !i.vic && !i.sid && !i.cia && !i.memory?.length && !i.symbols?.length && !i.screenshot && !i.spriteImages && !i.cpuHistoryCount;

        const rt = this.host.requireRuntime();
        const fetchBytes = async (s: number, e: number) => hexToBytes(await rt.retrieveMemory(s, e));
        const result: Record<string, any> = {};

        try {
            await rt.pause();
            // Await this shared read before starting other operations so a VICE
            // error cannot become an unhandled rejection during screenshot/CPU reads.
            const c2Bytes = (all || i.vic || i.cia || i.screenshot || i.spriteImages) ? await fetchBytes(CIA2_BASE, CIA2_END) : [];
            let screenshotData: Buffer | undefined;
            if (i.screenshot) {
                const ssResult = await this.getScreenshot(rt);
                Object.assign(result, ssResult);
                if (ssResult.screenshot?.rawBuffer) {
                    screenshotData = ssResult.screenshot.rawBuffer;
                    delete ssResult.screenshot.rawBuffer; // Remove from JSON
                }
            }

            if (all || i.cpu) {
                const regs = await rt.retrieveRegisters();
                result.cpu = formatRegs(regs);
                const pcReg = regs ? Object.values(regs).find(r => r.name === 'PC') : undefined;
                if (pcReg) {
                    const loc = rt.findSourceLineByAddr(pcReg.value);
                    if (loc?.src?.path) result.cpu.sourceLocation = { file: loc.src.path, line: loc.line };
                }

                try {
                    const stack = await rt.stackTrace();
                    if (stack && stack.length > 0) {
                        result.cpu.callStack = stack.map(f => ({
                            name: f.name,
                            file: f.source?.path,
                            line: f.line,
                            instructionPointer: f.instructionPointerReference
                        }));
                    }
                } catch (e) {
                    // Ignore stack trace errors
                }
            }

            if (i.cpuHistoryCount && i.cpuHistoryCount > 0) {
                try {
                    const hist = await rt.getCpuHistory(i.cpuHistoryCount);
                    result.cpuHistory = hist.map(item => ({
                        clock: item.clock.toString(),
                        instructionBytes: [...item.instructionBytes].map(b => hexPad(b, 2)).join(' '),
                        regs: Object.entries(item.regs).reduce((acc, [id, r]) => {
                            acc[id] = hexPad(r.value, 4);
                            return acc;
                        }, {} as Record<string, string>)
                    }));
                } catch (e) {
                    result.cpuHistory = { error: String(e) };
                }
            }

            if (all || i.vic || i.screenshot || i.spriteImages) {
                const vBytes = await fetchBytes(VIC_BASE, VIC_END);
                const bankBase = (~c2Bytes[0] & 0x03) * 0x4000;
                const vic18 = vBytes[0x18] ?? 0x14;
                const screenBase = bankBase + ((vic18 >> 4) & 0xF) * 0x400;
                const isBitmapMode = ((vBytes[0x11] ?? 0x1B) & 0x20) !== 0;

                const promises: Promise<number[]>[] = [
                    fetchBytes(screenBase, screenBase + COLOR_RAM_SIZE - 1),
                    fetchBytes(COLOR_RAM_BASE, COLOR_RAM_BASE + COLOR_RAM_SIZE - 1),
                    fetchBytes(screenBase + 0x03F8, screenBase + 0x03FF)
                ];

                let charsetBase = 0, bitmapBase = 0;
                if (isBitmapMode) {
                    bitmapBase = bankBase + (((vic18 >> 3) & 0x01) * 0x2000);
                    promises.push(fetchBytes(bitmapBase, bitmapBase + 0x1FFF)); // 8KB bitmap
                } else {
                    charsetBase = bankBase + (((vic18 >> 1) & 0x07) * 0x800);
                    promises.push(fetchBytes(charsetBase, charsetBase + 0x7FF)); // 2KB charset
                }

                const results = await Promise.all(promises);
                const sBytes = results[0];
                const cBytes = results[1];
                const spPtrs = results[2];
                const gfxBytes = results[3];

                const sprites = await Promise.all(spPtrs.map(async ptr => {
                    const addr = bankBase + ptr * 64;
                    return { pointer: ptr, address: hex4(addr), data: await fetchBytes(addr, addr + 63) };
                }));

                // Store sprite image buffers for later rendering
                const spriteImageBuffers: Buffer[] = [];
                if (i.spriteImages) {
                    for (let spriteIdx = 0; spriteIdx < sprites.length; spriteIdx++) {
                        const sprite = sprites[spriteIdx];
                        const spriteCR = vBytes[0x15]; // 0xD015 - Sprite Enable
                        const spriteDoubleWidth = vBytes[0x1D]; // 0xD01D - Sprite X Expansion
                        const spriteDoubleHeight = vBytes[0x17]; // 0xD017 - Sprite Y Expansion
                        const spriteMC = vBytes[0x1C]; // 0xD01C - Sprite Multicolor Mode
                        const spriteColorReg = vBytes[0x27 + spriteIdx]; // 0xD027-0xD02E - Sprite Colors

                        const isEnabled = (spriteCR & (1 << spriteIdx)) !== 0;
                        const isMulticolor = (spriteMC & (1 << spriteIdx)) !== 0;
                        const isDoubleWidth = (spriteDoubleWidth & (1 << spriteIdx)) !== 0;
                        const isDoubleHeight = (spriteDoubleHeight & (1 << spriteIdx)) !== 0;

                        const pngBuffer = this.renderSpriteImage(
                            sprite.data as number[],
                            spriteColorReg,
                            vBytes[0x25] ?? 0, // Multicolor 1 (0xD025)
                            vBytes[0x26] ?? 0, // Multicolor 2 (0xD026)
                            isMulticolor,
                            isDoubleWidth,
                            isDoubleHeight,
                            isEnabled
                        );
                        if (pngBuffer) {
                            spriteImageBuffers.push(pngBuffer);
                        }
                    }
                }

                result.vic = {
                    bank: bankBase / 0x4000,
                    bankBase: hex4(bankBase),
                    screenAddress: hex4(screenBase),
                    regs: vBytes,
                    screen: sBytes,
                    colorRam: cBytes,
                    sprites
                };

                if (isBitmapMode) {
                    result.vic.bitmapAddress = hex4(bitmapBase);
                    // result.vic.bitmapData = gfxBytes; // 8KB is too large, it might bloat the prompt
                    // Instead of full 8KB, perhaps omit or include it conditionally if really needed?
                    // We'll keep it there for completeness since the user asked for *all* bytes
                    result.vic.bitmapData = gfxBytes;
                } else {
                    result.vic.charsetAddress = hex4(charsetBase);
                    result.vic.charsetData = gfxBytes;
                }

                result.spriteImageBuffers = spriteImageBuffers;
            }

            if (all || i.sid) result.sid = { regs: await fetchBytes(SID_BASE, SID_END) };
            if (all || i.cia) {
                result.cia1 = { regs: await fetchBytes(CIA1_BASE, CIA1_END) };
                result.cia2 = { regs: c2Bytes };
            }

            if (i.memory?.length) {
                result.memory = await Promise.all(i.memory.map(async ({ start, end }) => {
                    // parseAddress already guarantees 0-0xFFFF; here we only cap
                    // the window to 16 KiB and keep end >= start.
                    const s = parseAddress(start)!;
                    const endNum = parseAddress(end);
                    const e = endNum !== undefined ? Math.max(s, Math.min(s + 0x3FFF, endNum)) : Math.min(0xFFFF, s + 0x3FFF);
                    return { start: hex4(s), end: hex4(e), data: await fetchBytes(s, e) };
                }));
            }

            if (i.symbols?.length) {
                result.symbols = {};
                for (const name of i.symbols) {
                    const sym = rt.lookupSymbol(name);
                    result.symbols[name] = sym ? {
                        address: sym.addr !== undefined ? hex4(sym.addr) : undefined,
                        size: sym.size,
                        ...(sym.value !== undefined ? { value: sym.value } : {}),
                        ...(sym.segmentName ? { segment: sym.segmentName } : {})
                    } : null;
                }
            }

            const imageParts: C64ToolContent[] = [];

            // Add screenshot if available
            if (screenshotData) {
                imageParts.push(imagePart(screenshotData));
            }

            // Add sprite images if available
            if (result.spriteImageBuffers) {
                const spriteBuffers = result.spriteImageBuffers as Buffer[];
                for (const buffer of spriteBuffers) {
                    imageParts.push(imagePart(buffer));
                }
                delete (result as any).spriteImageBuffers; // Remove from JSON output
            }

            if (imageParts.length) {
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...imageParts] };
            }
            return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
            return errorResult(e);
        }
    }

    private renderSpriteImage(
        spriteData: number[],
        colorReg: number,
        mc1: number,
        mc2: number,
        isMulticolor: boolean,
        isDoubleWidth: boolean,
        isDoubleHeight: boolean,
        isEnabled: boolean
    ): Buffer | null {
        try {
            const baseWidth = 24, baseHeight = 21;
            const width = isDoubleWidth ? baseWidth * 2 : baseWidth;
            const height = isDoubleHeight ? baseHeight * 2 : baseHeight;
            const rgba = Buffer.alloc(width * height * 4);

            const bgColor = c64Palette[0] || [0, 0, 0];
            const spriteColor = c64Palette[colorReg & 0x0F] || [255, 255, 255];
            const mc1Color = c64Palette[mc1 & 0x0F] || [0, 0, 0];
            const mc2Color = c64Palette[mc2 & 0x0F] || [128, 128, 128];

            // Fill with transparent/background
            for (let i = 0; i < rgba.length; i += 4) {
                rgba[i] = isEnabled ? bgColor[0] : 128;
                rgba[i + 1] = isEnabled ? bgColor[1] : 128;
                rgba[i + 2] = isEnabled ? bgColor[2] : 128;
                rgba[i + 3] = isEnabled ? 255 : 128; // Semi-transparent if disabled
            }

            // Process sprite data
            for (let row = 0; row < baseHeight; row++) {
                const byteOffset = row * 3;
                const b0 = spriteData[byteOffset] || 0;
                const b1 = spriteData[byteOffset + 1] || 0;
                const b2 = spriteData[byteOffset + 2] || 0;

                if (isMulticolor) {
                    // Each bit pair selects a color for two horizontal pixels.
                    for (let col = 0; col < 12; col++) {
                        const byteIdx = col < 4 ? 0 : col < 8 ? 1 : 2;
                        const byte = [b0, b1, b2][byteIdx];
                        const bitPos = 6 - ((col % 4) * 2);
                        const bits = (byte >> bitPos) & 0x03;

                        let color = bgColor;
                        if (bits === 1) color = mc1Color;
                        else if (bits === 2) color = spriteColor;
                        else if (bits === 3) color = mc2Color;

                        const outX = col * 2 * (isDoubleWidth ? 2 : 1);
                        const outY = row * (isDoubleHeight ? 2 : 1);
                        this.setPixels(rgba, width, outX, outY, color, isDoubleWidth ? 4 : 2, isDoubleHeight ? 2 : 1);
                    }
                } else {
                    // Single-color mode: 1 pixel per bit
                    for (let col = 0; col < 24; col++) {
                        const byteIdx = col < 8 ? 0 : col < 16 ? 1 : 2;
                        const byte = [b0, b1, b2][byteIdx];
                        const bitPos = 7 - (col % 8);
                        const bit = (byte >> bitPos) & 1;

                        const color = bit ? spriteColor : bgColor;
                        const outX = col * (isDoubleWidth ? 2 : 1);
                        const outY = row * (isDoubleHeight ? 2 : 1);
                        this.setPixels(rgba, width, outX, outY, color, isDoubleWidth ? 2 : 1, isDoubleHeight ? 2 : 1);
                    }
                }
            }

            return writePng(width, height, rgba);
        } catch (e) {
            console.error('Failed to render sprite:', e);
            return null;
        }
    }

    private setPixels(
        rgba: Buffer,
        width: number,
        x: number,
        y: number,
        color: number[],
        scaleX: number,
        scaleY: number
    ): void {
        for (let dy = 0; dy < scaleY; dy++) {
            for (let dx = 0; dx < scaleX; dx++) {
                const px = x + dx;
                const py = y + dy;
                if (px >= 0 && px < width && py >= 0) {
                    const idx = (py * width + px) * 4;
                    rgba[idx] = color[0];
                    rgba[idx + 1] = color[1];
                    rgba[idx + 2] = color[2];
                    rgba[idx + 3] = 255;
                }
            }
        }
    }

    private async getScreenshot(rt: C64jasmRuntime): Promise<Record<string, any>> {
        try {
            const res = await rt.getScreenshot();
            if (!res.imageData?.length) return { screenshot: { error: "Failed to capture screenshot." } };

            let rgba = res.imageData;
            if (res.bpp === 8) {
                rgba = Buffer.alloc(res.debugWidth * res.debugHeight * 4);
                for (let i = 0; i < res.imageData.length; i++) {
                    rgba.set([...(c64Palette[res.imageData[i] & 0x0F] || c64Palette[0]), 255], i * 4);
                }
            }

            const pngBuffer = writePng(res.debugWidth, res.debugHeight, rgba);
            const details = await this.host.saveScreenshot?.(pngBuffer, res.debugWidth, res.debugHeight);
            return { screenshot: { ...details, rawBuffer: pngBuffer, width: res.debugWidth, height: res.debugHeight } };
        } catch (e) {
            return { screenshot: { error: String(e instanceof Error ? e.message : e) } };
        }
    }
}

// ── Tool: Resolve Mapping ──────────────────────────────────────────────────

export interface ResolveMappingInput {
    address?: number | string;
    symbol?: string;
    filePath?: string;
    line?: number;
}

export class ResolveMappingTool {
    constructor(private readonly host: C64ToolHost) {}

    async invoke(input: ResolveMappingInput): Promise<C64ToolResult> {
        this.host.log(`[Tool] c64jasm_resolveMapping invoked: ${JSON.stringify(input)}`);

        try { this.host.requireRuntime(); } catch (e) {
            return errorResult(e);
        }

        const rt = this.host.requireRuntime();
        const i = input;
        const result: any = {};

        try {
            if (i.filePath && i.line) {
                const addr = rt.findAddressBySourceLine(i.filePath, i.line);
                result.address = addr !== null ? hex4(addr) : null;
            } else if (i.address !== undefined) {
                const addr = parseAddress(i.address)!;
                const loc = rt.findSourceLineByAddr(addr);
                result.sourceLocation = loc ? { file: loc.src.path, line: loc.line } : null;
            } else if (i.symbol) {
                const sym = rt.lookupSymbol(i.symbol);
                if (sym && sym.addr !== undefined) {
                    result.address = hex4(sym.addr);
                    const loc = rt.findSourceLineByAddr(sym.addr);
                    if (loc) {
                        result.sourceLocation = { file: loc.src.path, line: loc.line };
                    }
                } else {
                    result.error = `Symbol '${i.symbol}' not found`;
                }
            } else {
                result.error = "Provide either address, symbol, or filePath+line.";
            }

            return { ...textResult(JSON.stringify(result, null, 2)), ...(result.error ? { isError: true } : {}) };
        } catch (e) {
            return errorResult(e);
        }
    }
}

// ── Tool: Set Runtime C64 Memory ───────────────────────────────────────────

export interface SetRuntimeC64MemoryInput {
    address?: number | string;
    symbol?: string;
    filePath?: string;
    line?: number;
    values?: number[]; // Array of byte values (0-255)
    registers?: Record<string, number>; // CPU register name -> value, e.g. { "PC": 4096, "A": 5 }
}

export class SetRuntimeC64MemoryTool {
    constructor(private readonly host: C64ToolHost) {}

    async invoke(input: SetRuntimeC64MemoryInput, signal?: AbortSignal): Promise<C64ToolResult> {
        this.host.log(`[Tool] c64jasm_setRuntimeC64Memory invoked: ${JSON.stringify(input)}`);

        try { this.host.requireRuntime(); } catch (e) {
            return errorResult(e);
        }

        const rt = this.host.requireRuntime();
        const i = input;

        try {
            const result: any = {};
            const hasMemoryTarget = i.address !== undefined || !!i.symbol || (!!i.filePath && !!i.line);
            const hasRegisters = !!i.registers && Object.keys(i.registers).length > 0;

            if (!hasMemoryTarget && !hasRegisters) {
                throw new Error("Provide a memory target (address, symbol, or filePath+line) with 'values', and/or a 'registers' object.");
            }

            // Validate the entire request before applying any changes.
            let targetAddress: number | undefined;
            if (hasMemoryTarget) {
                if (!Array.isArray(i.values) || !i.values.length) {
                    throw new Error("A memory target was provided but 'values' (a non-empty byte array) is missing.");
                }
                if (i.values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
                    throw new Error("Memory values must be integer bytes (0-255).");
                }
                targetAddress = resolveTargetAddress(rt, i);
                if (targetAddress + i.values.length > 0x10000) throw new Error('Memory write extends past 0xFFFF.');
            }
            for (const [name, value] of Object.entries(i.registers ?? {})) {
                const register = name.toUpperCase();
                const maximum = register === 'PC' ? 65535 : 255;
                if (!['PC', 'A', 'X', 'Y', 'SP', 'P'].includes(register) || !Number.isInteger(value) || value < 0 || value > maximum) {
                    throw new Error(`Invalid register write: ${name} must be a supported register with an integer value in 0-${maximum}.`);
                }
            }

            // Write CPU registers (e.g. PC, A, X, Y, SP, P), if requested.
            if (hasRegisters) {
                const written: Record<string, string> = {};
                for (const [name, value] of Object.entries(i.registers!)) {
                    signal?.throwIfAborted();
                    await rt.writeRegister(name.toUpperCase(), value);
                    written[name.toUpperCase()] = hex4(value);
                }
                result.registers = written;
            }

            // Write a block of memory bytes, if a target was provided.
            if (hasMemoryTarget) {
                signal?.throwIfAborted();
                const data = new Uint8Array(i.values);
                await rt.writeMemoryBlock(targetAddress, data);
                result.memory = { targetAddress: hex4(targetAddress), bytesWritten: data.length };
            }

            result.success = true;
            return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
            return errorResult(e);
        }
    }
}
// ── Tool: Disassemble ────────────────────────────────────────────────────

export interface DisassembleInput {
    address?: number | string;
    symbol?: string;
    filePath?: string;
    line?: number;
    instructionCount?: number;
    offset?: number;
    source?: 'live' | 'build';
    bankId?: number;
}

export class DisassembleTool {
    constructor(private readonly host: C64ToolHost) {}

    async invoke(input: DisassembleInput): Promise<C64ToolResult> {
        this.host.log(`[Tool] c64jasm_disassemble invoked: ${JSON.stringify(input)}`);

        try { this.host.requireRuntime(); } catch (e) {
            return errorResult(e);
        }

        const rt = this.host.requireRuntime();
        const i = input;

        try {
            const startAddress = resolveTargetAddress(rt, i);

            const count = i.instructionCount && i.instructionCount > 0 ? Math.min(i.instructionCount, 256) : 16;
            const source = i.source ?? 'live';

            let instructions: any[];
            if (source === 'build') {
                // Static compiled image from the .disasm file; supports negative offset.
                instructions = await rt.disassemble(hex4(startAddress), count, i.offset ?? 0);
            } else {
                // Bytes currently in RAM (reflects live POKEs, self-modifying & banked code).
                instructions = await rt.disassembleLive(startAddress, count, i.bankId ?? 0);
            }

            return textResult(JSON.stringify({ source, start: hex4(startAddress), instructionCount: instructions.length, instructions }, null, 2));
        } catch (e) {
            return errorResult(e);
        }
    }
}
