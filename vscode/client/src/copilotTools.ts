// Copyright (c) 2025-2026 Luca Cappa All rights reserved

import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import { C64jasmRuntime, C64Regs } from './c64jasmRuntime';
import { writePng } from './writePng';
import { c64Palette } from './c64Palette';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

const VIC_BASE = 0xD000, VIC_END = 0xD02E;
const SID_BASE = 0xD400, SID_END = 0xD418;
const CIA1_BASE = 0xDC00, CIA1_END = 0xDC0F;
const CIA2_BASE = 0xDD00, CIA2_END = 0xDD0F;
const COLOR_RAM_BASE = 0xD800, COLOR_RAM_SIZE = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

const hexToBytes = (h: string): number[] => Array.from(Buffer.from(h, 'hex'));
const hexPad = (v: number, pad: number): string => v.toString(16).toUpperCase().padStart(pad, '0');
const hex4 = (v: number): string => `0x${hexPad(v, 4)}`;

function formatRegs(regs: C64Regs | null): Record<string, string> {
    if (!regs) return {};
    return Object.values(regs).reduce((acc, r) => {
        acc[r.name] = `0x${hexPad(r.value, r.byteCount * 2)}`;
        return acc;
    }, {} as Record<string, string>);
}

function getActiveSession(): vscode.DebugSession {
    const session = vscode.debug.activeDebugSession;
    if (!session || session.type !== 'c64jasm') {
        throw new Error('A debugger session is not running. It could be started by using the start action.');
    }
    return session;
}

const textResult = (text: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);

// ── Tool: Manage Debugger ──────────────────────────────────────────────────────

interface ManageDebuggerInput {
    action: 'start' | 'stop' | 'pause' | 'continue' | 'stepInto' | 'stepOver' | 'status';
    configName?: string;
    programPath?: string;
    sourcePath?: string;
    stopOnEntry?: boolean;
}

class ManageDebuggerTool implements vscode.LanguageModelTool<ManageDebuggerInput> {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<ManageDebuggerInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const { action, configName, programPath, sourcePath, stopOnEntry = true } = options.input;

        try {
            if (action === 'start') {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (configName) {
                    const ok = await vscode.debug.startDebugging(folder, configName);
                    return textResult(ok ? `Started session "${configName}".` : `Failed to start "${configName}".`);
                }
                const config: vscode.DebugConfiguration = {
                    type: 'c64jasm', request: 'launch', name: 'c64jasm Debug', stopOnEntry,
                    program: programPath ?? '${workspaceFolder}/main.prg',
                    ...(sourcePath && { source: sourcePath }),
                };
                const ok = await vscode.debug.startDebugging(folder, config);
                return textResult(ok ? 'Started session.' : 'Failed to start. Check program path.');
            }

            if (action === 'stop') {
                await vscode.debug.stopDebugging(getActiveSession());
                return textResult('Debugger stopped.');
            }

            if (['pause', 'continue', 'stepInto', 'stepOver'].includes(action)) {
                getActiveSession(); // Ensure running
                const cmdMap: Record<string, string> = { pause: 'pause', continue: 'continue', stepInto: 'stepInto', stepOver: 'stepOver' };
                await vscode.commands.executeCommand(`workbench.action.debug.${cmdMap[action]}`);
                return textResult(`Requested debugger ${action}.`);
            }

            if (action === 'status') {
                const session = vscode.debug.activeDebugSession;
                if (!session || session.type !== 'c64jasm') {
                    return textResult('No active c64jasm debug session.');
                }
                const rt = C64jasmRuntime.getInstance();
                const monitor = rt.monitor;
                if (!monitor) return textResult('Session active, but VICE x64sc not connected.');
                const isStopped = monitor.isStopped();
                return textResult(`Session active. State: ${isStopped ? 'paused (stopped) in VICE x64sc' : 'running in VICE x64sc'}.`);
            }

            return textResult(`Unknown action: ${action}`);
        } catch (e) {
            return textResult(String(e instanceof Error ? e.message : e));
        }
    }
}

// ── Tool: Manage Breakpoints ───────────────────────────────────────────────────

interface ManageBreakpointInput {
    action: 'set' | 'remove';
    filePath: string;
    line: number;
    condition?: string;
}

class ManageBreakpointTool implements vscode.LanguageModelTool<ManageBreakpointInput> {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<ManageBreakpointInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const { action, filePath, line, condition } = options.input;
        if (!filePath || line < 1) return textResult('Invalid input: requires filePath and positive line.');

        const uri = vscode.Uri.file(filePath);
        const position = new vscode.Position(line - 1, 0);

        if (action === 'set') {
            vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(uri, position), true, condition)]);
            return textResult(`Breakpoint set at ${filePath}:${line}${condition ? ` (condition: ${condition})` : ''}.`);
        }

        if (action === 'remove') {
            const bps = vscode.debug.breakpoints.filter(bp => 
                bp instanceof vscode.SourceBreakpoint && 
                bp.location.uri.fsPath === uri.fsPath && 
                bp.location.range.start.line === position.line
            );
            if (bps.length) {
                vscode.debug.removeBreakpoints(bps);
                return textResult(`Removed ${bps.length} breakpoint(s).`);
            }
            return textResult(`No breakpoint found at ${filePath}:${line}.`);
        }
        return textResult(`Unknown action: ${action}`);
    }
}

// ── Tool: Get C64 State ──────────────────────────────────────────────────────

interface GetRuntimeC64MemoryInput {
    cpu?: boolean;
    vic?: boolean;
    sid?: boolean;
    cia?: boolean;
    cpuHistoryCount?: number;
    memory?: { start: number; end?: number }[];
    symbols?: string[];
    screenshot?: boolean;
    spriteImages?: boolean;
}

class GetRuntimeC64MemoryTool implements vscode.LanguageModelTool<GetRuntimeC64MemoryInput> {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<GetRuntimeC64MemoryInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        try { getActiveSession(); } catch (e) { return textResult(JSON.stringify({ error: String(e instanceof Error ? e.message : e) })); }

        const i = options.input;
        const all = !i.cpu && !i.vic && !i.sid && !i.cia && !i.memory?.length && !i.symbols?.length && !i.screenshot && !i.spriteImages;
        
        const rt = C64jasmRuntime.getInstance();
        const fetchBytes = async (s: number, e: number) => hexToBytes(await rt.retrieveMemory(s, e));
        const sharedCia2Req = (all || i.vic || i.cia || i.screenshot) ? fetchBytes(CIA2_BASE, CIA2_END) : Promise.resolve([]);
        
        const result: Record<string, any> = {};

        try {
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
                const [vBytes, c2Bytes] = await Promise.all([fetchBytes(VIC_BASE, VIC_END), sharedCia2Req]);
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
                            vBytes[0x25] || 1, // Multicolor 1 (0xD025)
                            vBytes[0x26] || 1, // Multicolor 2 (0xD026)
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
                const [cia1, cia2] = await Promise.all([fetchBytes(CIA1_BASE, CIA1_END), sharedCia2Req]);
                result.cia1 = { regs: cia1 };
                result.cia2 = { regs: cia2 };
            }

            if (i.memory?.length) {
                result.memory = await Promise.all(i.memory.map(async ({ start, end }) => {
                    const s = Math.max(0, Math.min(0xFFFF, start));
                    const e = end !== undefined ? Math.max(s, Math.min(s + 0x3FFF, end)) : Math.min(0xFFFF, s + 0x3FFF);
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

            const imageParts: vscode.LanguageModelDataPart[] = [];
            
            // Add screenshot if available
            if (screenshotData) {
                imageParts.push(vscode.LanguageModelDataPart.image(new Uint8Array(screenshotData), 'image/png'));
            }

            // Add sprite images if available
            if (result.spriteImageBuffers) {
                const spriteBuffers = result.spriteImageBuffers as Buffer[];
                for (const buffer of spriteBuffers) {
                    imageParts.push(vscode.LanguageModelDataPart.image(new Uint8Array(buffer), 'image/png'));
                }
                delete (result as any).spriteImageBuffers; // Remove from JSON output
            }

            if (imageParts.length) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
                    ...imageParts
                ]);
            }
            return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
            return textResult(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
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
                    // Multicolor mode: 4 pixels per pair of bits
                    for (let col = 0; col < 12; col++) {
                        const byteIdx = col < 4 ? 0 : col < 8 ? 1 : 2;
                        const byte = [b0, b1, b2][byteIdx];
                        const bitPos = 6 - ((col % 4) * 2);
                        const bits = (byte >> bitPos) & 0x03;

                        let color = bgColor;
                        if (bits === 1) color = mc1Color;
                        else if (bits === 2) color = mc2Color;
                        else if (bits === 3) color = spriteColor;

                        const outX = col * 2;
                        const outY = row;
                        this.setPixels(rgba, width, outX, outY, color, 2, isDoubleHeight ? 2 : 1);
                    }
                } else {
                    // Single-color mode: 1 pixel per bit
                    for (let col = 0; col < 24; col++) {
                        const byteIdx = col < 8 ? 0 : col < 16 ? 1 : 2;
                        const byte = [b0, b1, b2][byteIdx];
                        const bitPos = 7 - (col % 8);
                        const bit = (byte >> bitPos) & 1;

                        const color = bit ? spriteColor : bgColor;
                        const outX = col;
                        const outY = row;
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

            const tmpPath = path.join(os.tmpdir(), `c64_${Date.now()}.png`);
            const pngBuffer = writePng(res.debugWidth, res.debugHeight, rgba)
            fs.writeFileSync(tmpPath, pngBuffer as Uint8Array);

            const CLIP_CMDS: Record<string, string> = {
                darwin: `osascript -e 'set the clipboard to (read (POSIX file "${tmpPath}") as «class PNGf»)'`,
                win32: `powershell -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${tmpPath}'))"`,
                linux: `xclip -selection clipboard -t image/png -i "${tmpPath}" || wl-copy -t image/png < "${tmpPath}"`
            };
            const cmd = CLIP_CMDS[os.platform()];
            if (cmd) exec(cmd, err => err && console.error('Clipboard error:', err));

            return { screenshot: { rawBuffer: pngBuffer, path: tmpPath, width: res.debugWidth, height: res.debugHeight, clipboard: cmd ? 'Copied' : 'Not supported' } };
        } catch (e) {
            return { screenshot: { error: String(e instanceof Error ? e.message : e) } };
        }
    }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerCopilotTools(context: ExtensionContext): void {
    context.subscriptions.push(
        vscode.lm.registerTool('c64jasm_manageDebugger', new ManageDebuggerTool()),
        vscode.lm.registerTool('c64jasm_manageBreakpoint', new ManageBreakpointTool()),
        vscode.lm.registerTool('c64jasm_getRuntimeC64Memory', new GetRuntimeC64MemoryTool())
    );
}
