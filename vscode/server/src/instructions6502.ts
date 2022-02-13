/**
 * 6502 Instruction Reference Data
 * Based on https://www.nesdev.org/obelisk-6502-guide/reference.html
 */

export interface AddressingMode {
    mode: string;
    opcode: string;
    bytes: number;
    cycles: string;
}

export interface FlagInfo {
    flag: string;
    name: string;
    description: string;
}

export interface InstructionInfo {
    name: string;
    fullName: string;
    formula?: string;
    description: string;
    flags: FlagInfo[];
    addressingModes: AddressingMode[];
    seeAlso?: string[];
    notes?: string;
}

export const instructions6502: { [key: string]: InstructionInfo } = {
    'adc': {
        name: 'ADC',
        fullName: 'Add with Carry',
        formula: 'A,Z,C,N = A+M+C',
        description: 'This instruction adds the contents of a memory location to the accumulator together with the carry bit. If overflow occurs the carry bit is set, this enables multiple byte addition to be performed.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set if overflow in bit 7' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'V', name: 'Overflow Flag', description: 'Set if sign bit is incorrect' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$69', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$65', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$75', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$6D', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$7D', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$79', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$61', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$71', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['SBC']
    },
    'and': {
        name: 'AND',
        fullName: 'Logical AND',
        formula: 'A,Z,N = A&M',
        description: 'A logical AND is performed, bit by bit, on the accumulator contents using the contents of a byte of memory.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$29', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$25', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$35', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$2D', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$3D', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$39', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$21', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$31', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['EOR', 'ORA']
    },
    'asl': {
        name: 'ASL',
        fullName: 'Arithmetic Shift Left',
        formula: 'A,Z,C,N = M*2 or M,Z,C,N = M*2',
        description: 'This operation shifts all the bits of the accumulator or memory contents one bit left. Bit 0 is set to 0 and bit 7 is placed in the carry flag. The effect of this operation is to multiply the memory contents by 2 (ignoring 2\'s complement considerations), setting the carry if the result will not fit in 8 bits.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set to contents of old bit 7' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Accumulator', opcode: '$0A', bytes: 1, cycles: '2' },
            { mode: 'Zero Page', opcode: '$06', bytes: 2, cycles: '5' },
            { mode: 'Zero Page,X', opcode: '$16', bytes: 2, cycles: '6' },
            { mode: 'Absolute', opcode: '$0E', bytes: 3, cycles: '6' },
            { mode: 'Absolute,X', opcode: '$1E', bytes: 3, cycles: '7' }
        ],
        seeAlso: ['LSR', 'ROL', 'ROR']
    },
    'bcc': {
        name: 'BCC',
        fullName: 'Branch if Carry Clear',
        description: 'If the carry flag is clear then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$90', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BCS']
    },
    'bcs': {
        name: 'BCS',
        fullName: 'Branch if Carry Set',
        description: 'If the carry flag is set then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$B0', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BCC']
    },
    'beq': {
        name: 'BEQ',
        fullName: 'Branch if Equal',
        description: 'If the zero flag is set then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$F0', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BNE']
    },
    'bit': {
        name: 'BIT',
        fullName: 'Bit Test',
        formula: 'A & M, N = M7, V = M6',
        description: 'This instructions is used to test if one or more bits are set in a target memory location. The mask pattern in A is ANDed with the value in memory to set or clear the zero flag, but the result is not kept. Bits 7 and 6 of the value from memory are copied into the N and V flags.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if the result if the AND is zero' },
            { flag: 'V', name: 'Overflow Flag', description: 'Set to bit 6 of the memory value' },
            { flag: 'N', name: 'Negative Flag', description: 'Set to bit 7 of the memory value' }
        ],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$24', bytes: 2, cycles: '3' },
            { mode: 'Absolute', opcode: '$2C', bytes: 3, cycles: '4' }
        ]
    },
    'bmi': {
        name: 'BMI',
        fullName: 'Branch if Minus',
        description: 'If the negative flag is set then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$30', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BPL']
    },
    'bne': {
        name: 'BNE',
        fullName: 'Branch if Not Equal',
        description: 'If the zero flag is clear then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$D0', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BEQ']
    },
    'bpl': {
        name: 'BPL',
        fullName: 'Branch if Positive',
        description: 'If the negative flag is clear then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$10', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BMI']
    },
    'brk': {
        name: 'BRK',
        fullName: 'Force Interrupt',
        description: 'The BRK instruction forces the generation of an interrupt request. The program counter and processor status are pushed on the stack then the IRQ interrupt vector at $FFFE/F is loaded into the PC and the break flag in the status set to one.',
        flags: [
            { flag: 'B', name: 'Break Command', description: 'Set to 1' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$00', bytes: 1, cycles: '7' }
        ],
        notes: 'The interpretation of a BRK depends on the operating system. On the BBC Microcomputer it is used by language ROMs to signal run time errors but it could be used for other purposes (e.g. calling operating system functions, etc.).'
    },
    'bvc': {
        name: 'BVC',
        fullName: 'Branch if Overflow Clear',
        description: 'If the overflow flag is clear then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$50', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BVS']
    },
    'bvs': {
        name: 'BVS',
        fullName: 'Branch if Overflow Set',
        description: 'If the overflow flag is set then add the relative displacement to the program counter to cause a branch to a new location.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$70', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BVC']
    },
    'clc': {
        name: 'CLC',
        fullName: 'Clear Carry Flag',
        formula: 'C = 0',
        description: 'Set the carry flag to zero.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set to 0' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$18', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['SEC']
    },
    'cld': {
        name: 'CLD',
        fullName: 'Clear Decimal Mode',
        formula: 'D = 0',
        description: 'Sets the decimal mode flag to zero.',
        flags: [
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Set to 0' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$D8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['SED'],
        notes: 'The state of the decimal flag is uncertain when the CPU is powered up and it is not reset when an interrupt is generated. In both cases you should include an explicit CLD to ensure that the flag is cleared before performing addition or subtraction.'
    },
    'cli': {
        name: 'CLI',
        fullName: 'Clear Interrupt Disable',
        formula: 'I = 0',
        description: 'Clears the interrupt disable flag allowing normal interrupt requests to be serviced.',
        flags: [
            { flag: 'I', name: 'Interrupt Disable', description: 'Set to 0' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$58', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['SEI']
    },
    'clv': {
        name: 'CLV',
        fullName: 'Clear Overflow Flag',
        formula: 'V = 0',
        description: 'Clears the overflow flag.',
        flags: [
            { flag: 'V', name: 'Overflow Flag', description: 'Set to 0' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$B8', bytes: 1, cycles: '2' }
        ]
    },
    'cmp': {
        name: 'CMP',
        fullName: 'Compare',
        formula: 'Z,C,N = A-M',
        description: 'This instruction compares the contents of the accumulator with another memory held value and sets the zero and carry flags as appropriate.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set if A >= M' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = M' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$C9', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$C5', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$D5', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$CD', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$DD', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$D9', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$C1', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$D1', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['CPX', 'CPY']
    },
    'cpx': {
        name: 'CPX',
        fullName: 'Compare X Register',
        formula: 'Z,C,N = X-M',
        description: 'This instruction compares the contents of the X register with another memory held value and sets the zero and carry flags as appropriate.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set if X >= M' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if X = M' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$E0', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$E4', bytes: 2, cycles: '3' },
            { mode: 'Absolute', opcode: '$EC', bytes: 3, cycles: '4' }
        ],
        seeAlso: ['CMP', 'CPY']
    },
    'cpy': {
        name: 'CPY',
        fullName: 'Compare Y Register',
        formula: 'Z,C,N = Y-M',
        description: 'This instruction compares the contents of the Y register with another memory held value and sets the zero and carry flags as appropriate.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set if Y >= M' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if Y = M' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$C0', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$C4', bytes: 2, cycles: '3' },
            { mode: 'Absolute', opcode: '$CC', bytes: 3, cycles: '4' }
        ],
        seeAlso: ['CMP', 'CPX']
    },
    'dec': {
        name: 'DEC',
        fullName: 'Decrement Memory',
        formula: 'M,Z,N = M-1',
        description: 'Subtracts one from the value held at a specified memory location setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if result is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$C6', bytes: 2, cycles: '5' },
            { mode: 'Zero Page,X', opcode: '$D6', bytes: 2, cycles: '6' },
            { mode: 'Absolute', opcode: '$CE', bytes: 3, cycles: '6' },
            { mode: 'Absolute,X', opcode: '$DE', bytes: 3, cycles: '7' }
        ],
        seeAlso: ['DEX', 'DEY']
    },
    'dex': {
        name: 'DEX',
        fullName: 'Decrement X Register',
        formula: 'X,Z,N = X-1',
        description: 'Subtracts one from the X register setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if X is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of X is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$CA', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['DEC', 'DEY']
    },
    'dey': {
        name: 'DEY',
        fullName: 'Decrement Y Register',
        formula: 'Y,Z,N = Y-1',
        description: 'Subtracts one from the Y register setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if Y is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of Y is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$88', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['DEC', 'DEX']
    },
    'eor': {
        name: 'EOR',
        fullName: 'Exclusive OR',
        formula: 'A,Z,N = A^M',
        description: 'An exclusive OR is performed, bit by bit, on the accumulator contents using the contents of a byte of memory.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$49', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$45', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$55', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$4D', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$5D', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$59', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$41', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$51', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['AND', 'ORA']
    },
    'inc': {
        name: 'INC',
        fullName: 'Increment Memory',
        formula: 'M,Z,N = M+1',
        description: 'Adds one to the value held at a specified memory location setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if result is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$E6', bytes: 2, cycles: '5' },
            { mode: 'Zero Page,X', opcode: '$F6', bytes: 2, cycles: '6' },
            { mode: 'Absolute', opcode: '$EE', bytes: 3, cycles: '6' },
            { mode: 'Absolute,X', opcode: '$FE', bytes: 3, cycles: '7' }
        ],
        seeAlso: ['INX', 'INY']
    },
    'inx': {
        name: 'INX',
        fullName: 'Increment X Register',
        formula: 'X,Z,N = X+1',
        description: 'Adds one to the X register setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if X is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of X is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$E8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['INC', 'INY']
    },
    'iny': {
        name: 'INY',
        fullName: 'Increment Y Register',
        formula: 'Y,Z,N = Y+1',
        description: 'Adds one to the Y register setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if Y is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of Y is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$C8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['INC', 'INX']
    },
    'jmp': {
        name: 'JMP',
        fullName: 'Jump',
        description: 'Sets the program counter to the address specified by the operand.',
        flags: [],
        addressingModes: [
            { mode: 'Absolute', opcode: '$4C', bytes: 3, cycles: '3' },
            { mode: 'Indirect', opcode: '$6C', bytes: 3, cycles: '5' }
        ],
        notes: 'An original 6502 has does not correctly fetch the target address if the indirect vector falls on a page boundary (e.g. $xxFF where xx is any value from $00 to $FF). In this case fetches the LSB from $xxFF as expected but takes the MSB from $xx00. This is fixed in some later chips like the 65SC02 so for compatibility always ensure the indirect vector is not at the end of the page.'
    },
    'jsr': {
        name: 'JSR',
        fullName: 'Jump to Subroutine',
        description: 'The JSR instruction pushes the address (minus one) of the return point on to the stack and then sets the program counter to the target memory address.',
        flags: [],
        addressingModes: [
            { mode: 'Absolute', opcode: '$20', bytes: 3, cycles: '6' }
        ],
        seeAlso: ['RTS']
    },
    'lda': {
        name: 'LDA',
        fullName: 'Load Accumulator',
        formula: 'A,Z,N = M',
        description: 'Loads a byte of memory into the accumulator setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of A is set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$A9', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$A5', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$B5', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$AD', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$BD', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$B9', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$A1', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$B1', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['LDX', 'LDY']
    },
    'ldx': {
        name: 'LDX',
        fullName: 'Load X Register',
        formula: 'X,Z,N = M',
        description: 'Loads a byte of memory into the X register setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if X = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of X is set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$A2', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$A6', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,Y', opcode: '$B6', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$AE', bytes: 3, cycles: '4' },
            { mode: 'Absolute,Y', opcode: '$BE', bytes: 3, cycles: '4 (+1 if page crossed)' }
        ],
        seeAlso: ['LDA', 'LDY']
    },
    'ldy': {
        name: 'LDY',
        fullName: 'Load Y Register',
        formula: 'Y,Z,N = M',
        description: 'Loads a byte of memory into the Y register setting the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if Y = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of Y is set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$A0', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$A4', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$B4', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$AC', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$BC', bytes: 3, cycles: '4 (+1 if page crossed)' }
        ],
        seeAlso: ['LDA', 'LDX']
    },
    'lsr': {
        name: 'LSR',
        fullName: 'Logical Shift Right',
        formula: 'A,C,Z,N = A/2 or M,C,Z,N = M/2',
        description: 'Each of the bits in A or M is shift one place to the right. The bit that was in bit 0 is shifted into the carry flag. Bit 7 is set to zero.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set to contents of old bit 0' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if result = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Accumulator', opcode: '$4A', bytes: 1, cycles: '2' },
            { mode: 'Zero Page', opcode: '$46', bytes: 2, cycles: '5' },
            { mode: 'Zero Page,X', opcode: '$56', bytes: 2, cycles: '6' },
            { mode: 'Absolute', opcode: '$4E', bytes: 3, cycles: '6' },
            { mode: 'Absolute,X', opcode: '$5E', bytes: 3, cycles: '7' }
        ],
        seeAlso: ['ASL', 'ROL', 'ROR']
    },
    'nop': {
        name: 'NOP',
        fullName: 'No Operation',
        description: 'The NOP instruction causes no changes to the processor other than the normal incrementing of the program counter to the next instruction.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$EA', bytes: 1, cycles: '2' }
        ]
    },
    'ora': {
        name: 'ORA',
        fullName: 'Logical Inclusive OR',
        formula: 'A,Z,N = A|M',
        description: 'An inclusive OR is performed, bit by bit, on the accumulator contents using the contents of a byte of memory.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$09', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$05', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$15', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$0D', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$1D', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$19', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$01', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$11', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['AND', 'EOR']
    },
    'pha': {
        name: 'PHA',
        fullName: 'Push Accumulator',
        description: 'Pushes a copy of the accumulator on to the stack.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$48', bytes: 1, cycles: '3' }
        ],
        seeAlso: ['PLA']
    },
    'php': {
        name: 'PHP',
        fullName: 'Push Processor Status',
        description: 'Pushes a copy of the status flags on to the stack.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$08', bytes: 1, cycles: '3' }
        ],
        seeAlso: ['PLP']
    },
    'pla': {
        name: 'PLA',
        fullName: 'Pull Accumulator',
        description: 'Pulls an 8 bit value from the stack and into the accumulator. The zero and negative flags are set as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of A is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$68', bytes: 1, cycles: '4' }
        ],
        seeAlso: ['PHA']
    },
    'plp': {
        name: 'PLP',
        fullName: 'Pull Processor Status',
        description: 'Pulls an 8 bit value from the stack and into the processor flags. The flags will take on new states as determined by the value pulled.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set from stack' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set from stack' },
            { flag: 'I', name: 'Interrupt Disable', description: 'Set from stack' },
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Set from stack' },
            { flag: 'B', name: 'Break Command', description: 'Set from stack' },
            { flag: 'V', name: 'Overflow Flag', description: 'Set from stack' },
            { flag: 'N', name: 'Negative Flag', description: 'Set from stack' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$28', bytes: 1, cycles: '4' }
        ],
        seeAlso: ['PHP']
    },
    'rol': {
        name: 'ROL',
        fullName: 'Rotate Left',
        description: 'Move each of the bits in either A or M one place to the left. Bit 0 is filled with the current value of the carry flag whilst the old bit 7 becomes the new carry flag value.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set to contents of old bit 7' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Accumulator', opcode: '$2A', bytes: 1, cycles: '2' },
            { mode: 'Zero Page', opcode: '$26', bytes: 2, cycles: '5' },
            { mode: 'Zero Page,X', opcode: '$36', bytes: 2, cycles: '6' },
            { mode: 'Absolute', opcode: '$2E', bytes: 3, cycles: '6' },
            { mode: 'Absolute,X', opcode: '$3E', bytes: 3, cycles: '7' }
        ],
        seeAlso: ['ASL', 'LSR', 'ROR']
    },
    'ror': {
        name: 'ROR',
        fullName: 'Rotate Right',
        description: 'Move each of the bits in either A or M one place to the right. Bit 7 is filled with the current value of the carry flag whilst the old bit 0 becomes the new carry flag value.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set to contents of old bit 0' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of the result is set' }
        ],
        addressingModes: [
            { mode: 'Accumulator', opcode: '$6A', bytes: 1, cycles: '2' },
            { mode: 'Zero Page', opcode: '$66', bytes: 2, cycles: '5' },
            { mode: 'Zero Page,X', opcode: '$76', bytes: 2, cycles: '6' },
            { mode: 'Absolute', opcode: '$6E', bytes: 3, cycles: '6' },
            { mode: 'Absolute,X', opcode: '$7E', bytes: 3, cycles: '7' }
        ],
        seeAlso: ['ASL', 'LSR', 'ROL']
    },
    'rti': {
        name: 'RTI',
        fullName: 'Return from Interrupt',
        description: 'The RTI instruction is used at the end of an interrupt processing routine. It pulls the processor flags from the stack followed by the program counter.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set from stack' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set from stack' },
            { flag: 'I', name: 'Interrupt Disable', description: 'Set from stack' },
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Set from stack' },
            { flag: 'B', name: 'Break Command', description: 'Set from stack' },
            { flag: 'V', name: 'Overflow Flag', description: 'Set from stack' },
            { flag: 'N', name: 'Negative Flag', description: 'Set from stack' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$40', bytes: 1, cycles: '6' }
        ]
    },
    'rts': {
        name: 'RTS',
        fullName: 'Return from Subroutine',
        description: 'The RTS instruction is used at the end of a subroutine to return to the calling routine. It pulls the program counter (minus one) from the stack.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$60', bytes: 1, cycles: '6' }
        ],
        seeAlso: ['JSR']
    },
    'sbc': {
        name: 'SBC',
        fullName: 'Subtract with Carry',
        formula: 'A,Z,C,N = A-M-(1-C)',
        description: 'This instruction subtracts the contents of a memory location to the accumulator together with the not of the carry bit. If overflow occurs the carry bit is clear, this enables multiple byte subtraction to be performed.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Clear if overflow in bit 7' },
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'V', name: 'Overflow Flag', description: 'Set if sign bit is incorrect' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 set' }
        ],
        addressingModes: [
            { mode: 'Immediate', opcode: '$E9', bytes: 2, cycles: '2' },
            { mode: 'Zero Page', opcode: '$E5', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$F5', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$ED', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$FD', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: 'Absolute,Y', opcode: '$F9', bytes: 3, cycles: '4 (+1 if page crossed)' },
            { mode: '(Indirect,X)', opcode: '$E1', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$F1', bytes: 2, cycles: '5 (+1 if page crossed)' }
        ],
        seeAlso: ['ADC']
    },
    'sec': {
        name: 'SEC',
        fullName: 'Set Carry Flag',
        formula: 'C = 1',
        description: 'Set the carry flag to one.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Set to 1' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$38', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['CLC']
    },
    'sed': {
        name: 'SED',
        fullName: 'Set Decimal Flag',
        formula: 'D = 1',
        description: 'Set the decimal mode flag to one.',
        flags: [
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Set to 1' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$F8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['CLD']
    },
    'sei': {
        name: 'SEI',
        fullName: 'Set Interrupt Disable',
        formula: 'I = 1',
        description: 'Set the interrupt disable flag to one.',
        flags: [
            { flag: 'I', name: 'Interrupt Disable', description: 'Set to 1' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$78', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['CLI']
    },
    'sta': {
        name: 'STA',
        fullName: 'Store Accumulator',
        formula: 'M = A',
        description: 'Stores the contents of the accumulator into memory.',
        flags: [],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$85', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$95', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$8D', bytes: 3, cycles: '4' },
            { mode: 'Absolute,X', opcode: '$9D', bytes: 3, cycles: '5' },
            { mode: 'Absolute,Y', opcode: '$99', bytes: 3, cycles: '5' },
            { mode: '(Indirect,X)', opcode: '$81', bytes: 2, cycles: '6' },
            { mode: '(Indirect),Y', opcode: '$91', bytes: 2, cycles: '6' }
        ],
        seeAlso: ['STX', 'STY']
    },
    'stx': {
        name: 'STX',
        fullName: 'Store X Register',
        formula: 'M = X',
        description: 'Stores the contents of the X register into memory.',
        flags: [],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$86', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,Y', opcode: '$96', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$8E', bytes: 3, cycles: '4' }
        ],
        seeAlso: ['STA', 'STY']
    },
    'sty': {
        name: 'STY',
        fullName: 'Store Y Register',
        formula: 'M = Y',
        description: 'Stores the contents of the Y register into memory.',
        flags: [],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$84', bytes: 2, cycles: '3' },
            { mode: 'Zero Page,X', opcode: '$94', bytes: 2, cycles: '4' },
            { mode: 'Absolute', opcode: '$8C', bytes: 3, cycles: '4' }
        ],
        seeAlso: ['STA', 'STX']
    },
    'tax': {
        name: 'TAX',
        fullName: 'Transfer Accumulator to X',
        formula: 'X = A',
        description: 'Copies the current contents of the accumulator into the X register and sets the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if X = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of X is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$AA', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TXA']
    },
    'tay': {
        name: 'TAY',
        fullName: 'Transfer Accumulator to Y',
        formula: 'Y = A',
        description: 'Copies the current contents of the accumulator into the Y register and sets the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if Y = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of Y is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$A8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TYA']
    },
    'tsx': {
        name: 'TSX',
        fullName: 'Transfer Stack Pointer to X',
        formula: 'X = S',
        description: 'Copies the current contents of the stack register into the X register and sets the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if X = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of X is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$BA', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TXS']
    },
    'txa': {
        name: 'TXA',
        fullName: 'Transfer X to Accumulator',
        formula: 'A = X',
        description: 'Copies the current contents of the X register into the accumulator and sets the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of A is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$8A', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TAX']
    },
    'txs': {
        name: 'TXS',
        fullName: 'Transfer X to Stack Pointer',
        formula: 'S = X',
        description: 'Copies the current contents of the X register into the stack register.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$9A', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TSX']
    },
    'tya': {
        name: 'TYA',
        fullName: 'Transfer Y to Accumulator',
        formula: 'A = Y',
        description: 'Copies the current contents of the Y register into the accumulator and sets the zero and negative flags as appropriate.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Set if A = 0' },
            { flag: 'N', name: 'Negative Flag', description: 'Set if bit 7 of A is set' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$98', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TAY']
    }
};
