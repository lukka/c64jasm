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
}

class GetRuntimeC64MemoryTool implements vscode.LanguageModelTool<GetRuntimeC64MemoryInput> {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<GetRuntimeC64MemoryInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        try { getActiveSession(); } catch (e) { return textResult(JSON.stringify({ error: String(e instanceof Error ? e.message : e) })); }

        const i = options.input;
        const all = !i.cpu && !i.vic && !i.sid && !i.cia && !i.memory?.length && !i.symbols?.length && !i.screenshot;
        
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

            if (all || i.vic || i.screenshot) {
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

            if (screenshotData) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
                    vscode.LanguageModelDataPart.image(new Uint8Array(screenshotData), 'image/png')
                ]);
            }
            return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
            return textResult(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
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
            fs.writeFileSync(tmpPath, pngBuffer);

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
