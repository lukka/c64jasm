
import * as process from 'process'
import { readFileSync, writeFileSync } from 'fs'

import opcodes from './opcodes'

function toHex8(v: number): string {
    return `${v.toString(16).toUpperCase().padStart(2, '0')}`
}

function toHex16(v: number): string {
    return `${v.toString(16).toUpperCase().padStart(4, '0')}`
}

class Disassembler {
    private curAddr: number;
    private curOffs: number;
    private opToDecl: object;
    constructor (private buf: Buffer) {
        this.curAddr = buf.readUInt8(0) + (buf.readUInt8(1)<<8);
        this.curAddr += 12;
        this.curOffs = 2 + 12;

        this.opToDecl = {}
        Object.keys(opcodes).forEach(key => {
            let decl = opcodes[key]
            for (let i = 0; i < decl.length; i++) {
                this.opToDecl[decl[i]] = { mnemonic: key, decode: decl };
            }
        })
    }

    byte = () => {
        const b = this.buf.readUInt8(this.curOffs);
        this.curOffs++;
        return b
    }

    print = (addr, bytes, decoded) => {

        const b0 = toHex8(bytes[0]);
        const b1 = bytes.length >= 2 ? toHex8(bytes[1]) : '  ';
        const b2 = bytes.length >= 3 ? toHex8(bytes[2]) : '  ';

        process.stdout.write(`${toHex16(addr)}: ${b0} ${b1} ${b2}     ${decoded}\n`);
    }

    disImm = (mnemonic, op) => {
        const addr = this.curAddr;
        const imm = this.byte();
        this.print(addr, [op, imm], `${mnemonic} #${toHex8(imm)}`)
    }

    disZp = (mnemonic, op) => {
        const addr = this.curAddr;
        const zp = this.byte();
        this.print(addr, [op, zp], `${mnemonic} $${toHex8(zp)}`)
    }

    disZpX = (mnemonic, op) => {
        const addr = this.curAddr;
        const zp = this.byte();
        this.print(addr, [op, zp], `${mnemonic} $${toHex8(zp)},X`)
    }

    disZpY = (mnemonic, op) => {
        const addr = this.curAddr;
        const zp = this.byte();
        this.print(addr, [op, zp], `${mnemonic} $${toHex8(zp)},Y`)
    }

    disAbs = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        const hi = this.byte();
        this.print(addr, [op, lo, hi], `${mnemonic} $${toHex16(lo + hi*256)}`)
    }

    disAbsX = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        const hi = this.byte();
        this.print(addr, [op, lo, hi], `${mnemonic} $${toHex16(lo + hi*256)},X`)
    }

    disAbsY = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        const hi = this.byte();
        this.print(addr, [op, lo, hi], `${mnemonic} $${toHex16(lo + hi*256)},Y`)
    }

    disInd = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        const hi = this.byte();
        this.print(addr, [op, lo, hi], `${mnemonic} ($${toHex16(lo + hi*256)})`)
    }

    disIndX = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        this.print(addr, [op, lo], `${mnemonic} ($${toHex8(lo)},X)`)
    }

    disIndY = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        this.print(addr, [op, lo], `${mnemonic} ($${toHex8(lo)}),Y`)
    }

    disSingle = (mnemonic, op) => {
        const addr = this.curAddr;
        this.print(addr, [op], `${mnemonic}`)
    }

    disBranch = (mnemonic, op) => {
        const addr = this.curAddr;
        const lo = this.byte();
        const bofs = lo >= 128 ? -(256-lo) : lo
        const tgt = addr + bofs + 2;
        this.print(addr, [op, lo], `${mnemonic} $${toHex16(tgt)}`)
    }

    disassemble = () => {
        const len = this.buf.byteLength;

        let oldOffs = this.curOffs
        while (this.curOffs < len) {
            this.curAddr += this.curOffs - oldOffs;
            oldOffs = this.curOffs;

            const op = this.byte()
            const decl = this.opToDecl[op];

            if (decl !== undefined) {
                const decoderIdx = decl.decode.indexOf(op);
                if (decoderIdx === 0) {
                    this.disImm(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 1) {
                    this.disZp(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 2) {
                    this.disZpX(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 3) {
                    this.disZpY(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 4) {
                    this.disAbs(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 5) {
                    this.disAbsX(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 6) {
                    this.disAbsY(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 7) {
                    this.disInd(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 8) {
                    this.disIndX(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 10) {
                    this.disSingle(decl.mnemonic, op);
                    continue;
                }
                if (decoderIdx === 11) {
                    this.disBranch(decl.mnemonic, op);
                    continue;
                }
            }
        }
    }
}

function main () {
    const lastArg = process.argv[process.argv.length-1];
    const prg = readFileSync(lastArg);

    let disasm = new Disassembler(prg);
    disasm.disassemble();
}

main();
