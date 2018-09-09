
import * as process from 'process'

import opcodes from './opcodes'

let parser = require('./g_parser.js')

import { readFileSync, writeFileSync } from 'fs'

interface SourceLine {
    lineNo: number,
    line: string
}

interface StmtEmitBytes {
    type: "byte" | "word";
    values: any[];
}

interface Stmt {
    type: string,
}

interface LineAst {
    label: string | null,
    stmt: Stmt | null
}

function toHex16(v: number): string {
    return v.toString(16).padStart(4, '0');
}

function readLines (fname) {
    return readFileSync(fname).toString().split('\n')
}

const filterMap = (lst, mf) => {
    return lst.map((l,i) => mf(l, i)).filter(elt => elt !== null);
}

function tryParseInt(s): number | null {
    if (s.length < 1) {
        return null
    }
    if (s[0] == '$') {
        const v = parseInt(s.slice(1), 16);
        return isNaN(v) ? null : v
    } else {
        const v = parseInt(s, 10);
        return isNaN(v) ? null : v
    }
}

function tryParseSymbol(s): string | null {
    const m = /^([a-zA-Z_]+[0-9a-zA-Z_]*)$/.exec(s)
    if (m !== null) {
        return m[1];
    }
    return null
}

function toHex(num) {
    const h = num.toString(16)
    return num < 16 ? `0${h}` : `${h}`
}

interface Label {
    addr: number,
    lineNo: number
}

class Labels {
    labels = {}

    add = (name: string, addr: number, lineNo: number) => {
        const lbl: Label = {
            addr,
            lineNo
        }
        this.labels[name] = lbl
    }

    find = (name: string) => {
        return this.labels[name]
    }
}

class Assembler {
    // TODO this should be a resizable array instead
    binary: number[] = [];

    currentLineNo = 0;
    codePC = 0;
    pass = 0;
    labels = new Labels()

    prg = () => {
      // 1,8 is for encoding the $0801 starting address in the .prg file
      return Buffer.from([1, 8].concat(this.binary))
    }

    error = (err: string) => {
        console.log(`src/foo.asm:${this.currentLineNo} - ${err}`)
    }

    startPass = (pass: number) => {
      this.codePC = 0x801;
      this.pass = pass;
      this.binary = [];
    }

    emitBasicHeader = () => {
      this.emit(0x0c);
      this.emit(0x08);
      this.emit(0x00);
      this.emit(0x00);
      this.emit(0x9e);
      const addr = 0x80d
      const dividers = [10000, 1000, 100, 10, 1]
      dividers.forEach(div => {
        if (addr >= div) {
          this.emit(0x30 + (addr / div) % 10)
        }
      });
      this.emit(0);
      this.emit(0);
      this.emit(0);
    }

    emitBinary = (ast) => {
        const { filename } = ast
        const buf: Buffer = readFileSync(filename)

        let offset = ast.offset !== null ? this.evalExpr(ast.offset) : 0;
        let size = ast.size !== null ? this.evalExpr(ast.size) : buf.byteLength - offset;

        if (offset === null || size === null) {
            return false;
        }

        // TODO buffer overflow
        for (let i = 0; i < size; i++) {
            this.emit(buf.readUInt8(i + offset));
        }
        return true
    }

    evalExpr = (ast) => {
        const evalExpr = (node) => {
            if (node.type === 'binary') {
                const left = evalExpr(node.left);
                const right = evalExpr(node.right);
                if (left === null || right === null) {
                    return null
                }
                switch (node.op) {
                    case '+': return left + right
                    case '-': return left - right
                    case '*': return left * right
                    case '/': return left / right
                    case '%': return left % right
                    case '&': return left & right
                    case '|': return left | right
                    case '^': return left ^ right
                    case '<<': return left << right
                    case '>>': return left >> right
                    default:
                        this.error(`Unhandled binary operator ${node.operator}`);
                        return null
                }
            }
            if (node.type === 'UnaryExpression') {
                const arg = evalExpr(node.argument);
                switch (node.operator) {
                    case '-': return -arg
                    case '~': return ~arg
                    default:
                        this.error(`Unhandled unary operator ${node.operator}`);
                        return null
                }
            }
            if (node.type == 'literal') {
                return node.value
            }
            if (node.type == 'ident') {
                if (this.pass == 1) {
                    const label = node.name
                    const lbl = this.labels.find(label);
                    if (!lbl) {
                        this.error(`Undefined label '${label}'`)
                        return null
                    }
                    // TODO can also be a constant
                    return lbl.addr
                }
                // TODO add a flag to evalExpr that can be used to trigger an
                // error in this case!  Many operations require that a value can
                // be computed in the first pass and just returning zero will
                // totally make stuff like !binary go nuts.
                return 0
            }
        }
        return evalExpr(ast);
    }
    emit = (byte: number) => {
        this.binary.push(byte);
        this.codePC += 1
    }

    emit16 = (word: number) => {
        this.emit(word & 0xff);
        this.emit((word>>8) & 0xff);
    }

    // TODO shouldn't have any for opcode
    checkSingle = (opcode: number | null) => {
        if (opcode === null) {
            return false;
        }
        this.emit(opcode)
        return true;
    }

    checkImm = (param: any, opcode: number | null) => {
        if (opcode === null || param === null) {
            return false;
        }
        const val = this.evalExpr(param);
        if (val !== null) {
            if (val < 0 || val > 255) {
                return false
            }
            this.emit(opcode)
            this.emit(val)
            return true
        }
        return false;
    }

    checkAbs = (param: any, opcode: number | null, bits: number) => {
        if (opcode === null || param === null) {
            return false;
        }
        const val = this.evalExpr(param);
        if (val !== null) {
            if (val < 0 || val >= (1<<bits)) {
                return false
            }
            this.emit(opcode)
            if (bits === 8) {
                this.emit(val)
            } else {
                this.emit16(val)
            }
            return true
        }
        return false
    }

    checkBranch = (param: any, opcode: number | null) => {
        if (opcode === null || param === null) {
            return false;
        }
        if (this.pass === 0) {
            this.emit(0);
            this.emit(0);
            return true;
        }
        const addr = this.evalExpr(param);
        this.emit(opcode);
        // TODO check 8-bit overflow here!!
        if (addr < (this.codePC - 0x600)) {  // Backwards?
          this.emit((0xff - ((this.codePC - 0x600) - addr)) & 0xff);
          return true;
        }
        this.emit((addr - (this.codePC - 0x600) - 1) & 0xff);
        return true;
      }

    setPC = (valueExpr) => {
        const v = this.evalExpr(valueExpr);
        if (v === null) {
            this.error(`Couldn't evaluate expression value`);
            return false
        }
        while (this.codePC < v) {
            this.emit(0);
        }
        return true
}

    checkDirectives = (ast) => {
        const tryIntArg = (exprList, bits) => {
            // TODO must handle list of bytes
            for (let i = 0; i < exprList.length; i++) {
                const v = this.evalExpr(exprList[i]);
                if (v === null) {
                    this.error(`Couldn't evaluate expression value`);
                    return false
                }
                if (bits === 8) {
                    this.emit(v);
                } else {
                    if (bits !== 16) {
                        throw 'impossible'
                    }
                    this.emit16(v);
                }
            }
            return true
        }
        switch (ast.type) {
            case "byte":
            case "word": {
                const emitNode: StmtEmitBytes = ast
                return tryIntArg(emitNode.values, ast.type === 'byte' ? 8 : 16);
            }
            case "setpc": {
                return this.setPC(ast.pc);
            }
            case "binary": {
                return this.emitBinary(ast);
            }
            default:
                this.error(`Unknown directive ${ast.directive}`);
                return false
        }
    }

    assembleLine = (line) => {
        // Empty lines are no-ops
        if (line === null) {
            return true;
        }
        const lineNo = 13 // TODO stick this in stmt in parser
        this.currentLineNo = lineNo;

        if (line.label !== null) {
            const lblSymbol = line.label

            if (this.pass === 0) {
                const oldLabel = this.labels.find(lblSymbol)
                if (oldLabel === undefined) {
                    this.labels.add(lblSymbol, this.codePC, lineNo);
                } else {
                    this.error(`Label '${lblSymbol}' already defined on line ${oldLabel.lineNo}`)
                    return
                }
            }
        }

        if (line.stmt === null) {
            return true
        }

        if (line.stmt.type !== 'insn') {
            return this.checkDirectives(line.stmt);
        }

        const stmt = line.stmt
        const insn = stmt.insn
        const op = opcodes[insn.mnemonic.toUpperCase()]
        if (op !== undefined) {
            let noArgs =
                insn.imm === null
                && insn.abs === null
                && insn.absx === null
                && insn.absy === null
                && insn.absind === null
            if (noArgs && this.checkSingle(op[10])) {
                return true;
            }
            if (this.checkImm(insn.imm, op[0])) {
                return true;
            }
            if (this.checkAbs(insn.abs, op[1], 8)) {
                return true;
            }

/*
          if (checkZeroPageX(param, Opcodes[o][2])) { return true; }
          if (checkZeroPageY(param, Opcodes[o][3])) { return true; }
*/
            if (this.checkAbs(insn.absx, op[5], 16)) {
                return true;
            }
            if (this.checkAbs(insn.absy, op[6], 16)) {
                return true;
            }
            // Absolute indirect
            if (this.checkAbs(insn.absind, op[7], 16)) {
                return true;
            }
/*
          if (checkIndirectX(param, Opcodes[o][8])) { return true; }
          if (checkIndirectY(param, Opcodes[o][9])) { return true; }
*/

            if (this.checkAbs(insn.abs, op[4], 16)) {
                return true;
            }
            if (this.checkBranch(insn.abs, op[11])) {
                return true;
            }
        }
        console.log('**** ERROR ERROR ERROR ****')
        return false;
    }

    assemble = (source) => {
        const statements = parser.parse(source)

        this.emitBasicHeader()
        for (let i = 0; i < statements.length; i++) {
            const ok = this.assembleLine(statements[i]);
            if (!ok) {
                this.error('Breaking out.');
                break;
            }
        }
    }
}

function main() {
    const lastArg = process.argv[process.argv.length-1];
    const asm = new Assembler()
    const src = readFileSync(lastArg).toString();


    asm.startPass(0);
    asm.assemble(src);
    asm.startPass(1);
    asm.assemble(src);
    writeFileSync('test.prg', asm.prg(), null)
}

main();

//console.log(parser.parse('1+3'));
//console.log(parser.parse('1+( 1 + 3 ) / 2'));

/*
console.log(parser.parse(' lda #127 '));
console.log(parser.parse(' lda #foobar'));
console.log(parser.parse(' lda foobarr'));
console.log(parser.parse(' jmp jope'));
console.log(parser.parse(' inc $d020'));
*/
