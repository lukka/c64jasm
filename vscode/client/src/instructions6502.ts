/**
 * 6502 Instruction Reference Data
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
        formula: 'Accumulator = Accumulator + Memory + Carry',
        description: 'Computes the sum of the accumulator, the specified memory operand, and the carry flag. The result is placed within the accumulator. It handles multi-byte arithmetic operations effectively, mutating status flags based on the outcome.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Activated upon a calculation exceeding 8-bit capacity' },
            { flag: 'Z', name: 'Zero Flag', description: 'Activated if the resulting accumulator value is zero' },
            { flag: 'V', name: 'Overflow Flag', description: 'Activated if two\'s complement directional boundary is breached' },
            { flag: 'N', name: 'Negative Flag', description: 'Activated if the highest bit (sign) is one' }
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
        formula: 'Accumulator = Accumulator & Memory',
        description: 'Executes a bitwise logical AND between the current accumulator value and a memory fetch. The accumulator incorporates the newly evaluated bits.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Activated if the calculation evaluates to zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Activated if the highest order bit is enabled' }
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
        formula: 'Shift Left (Operand) -> Carry',
        description: 'Displaces all bits of the target operand (accumulator or memory) one position to the left. The vacated earliest bit is cleared to zero, whereas the original highest bit overflows into the carry flag. Essentially, this corresponds to an unsigned multiplication by two.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Takes on the bit 7 value prior to the shift' },
            { flag: 'Z', name: 'Zero Flag', description: 'Activated if the shifted value is completely zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Activated if the new bit 7 evaluates to one' }
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
        description: 'Triggers a jump to a relative memory offset provided the carry flag strictly evaluates to a clear state (zero). Execution proceeds linearly otherwise.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$90', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BCS']
    },
    'bcs': {
        name: 'BCS',
        fullName: 'Branch if Carry Set',
        description: 'Performs a conditional sub-program jump utilizing a relative offset exclusively when the carry flag registers as actively set (one).',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$B0', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BCC']
    },
    'beq': {
        name: 'BEQ',
        fullName: 'Branch if Equal',
        description: 'Diverts the execution flow via a relative displacement contingent upon the zero flag being active, typically indicative of an equality condition following a comparison.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$F0', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BNE']
    },
    'bit': {
        name: 'BIT',
        fullName: 'Bit Test',
        formula: 'Bitwise AND Contextual Test',
        description: 'Probes specific bits within a target memory address. A non-destructive bitwise AND is conducted against the accumulator to update the zero flag. Additionally, the uppermost two bits of the memory operand are directly transposed into the Negative and Overflow status flags.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Activated if the non-destructive AND evaluation results in zero' },
            { flag: 'V', name: 'Overflow Flag', description: 'Synchronized with bit 6 of the examined memory byte' },
            { flag: 'N', name: 'Negative Flag', description: 'Synchronized with bit 7 of the examined memory byte' }
        ],
        addressingModes: [
            { mode: 'Zero Page', opcode: '$24', bytes: 2, cycles: '3' },
            { mode: 'Absolute', opcode: '$2C', bytes: 3, cycles: '4' }
        ]
    },
    'bmi': {
        name: 'BMI',
        fullName: 'Branch if Minus',
        description: 'Initiates a branch execution using the given relative offset exclusively if the negative flag is marked as active, indicating a logical minus.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$30', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BPL']
    },
    'bne': {
        name: 'BNE',
        fullName: 'Branch if Not Equal',
        description: 'Redirects the CPU execution path based on a relative modifier provided the zero flag remains unasserted, which typically represents an inequality.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$D0', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BEQ']
    },
    'bpl': {
        name: 'BPL',
        fullName: 'Branch if Positive',
        description: 'Engages a conditional instruction branch employing a relative coordinate if the negative status flag is observed as cleared, denoting a positive value.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$10', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BMI']
    },
    'brk': {
        name: 'BRK',
        fullName: 'Force Interrupt',
        description: 'Instigates a software-driven interrupt sequence. The routine preserves the program counter and processor status by pushing them onto the stack, asserts the break flag, and redirects processing to the designated IRQ vector.',
        flags: [
            { flag: 'B', name: 'Break Command', description: 'Asserted into the stack status byte' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$00', bytes: 1, cycles: '7' }
        ],
        notes: 'Software and operating systems frequently co-opt this instruction to flag severe runtime anomalies or to facilitate high-level system calls.'
    },
    'bvc': {
        name: 'BVC',
        fullName: 'Branch if Overflow Clear',
        description: 'Alters the linear instruction path by evaluating a relative boundary jump, functioning only when the overflow flag indicates a clear state.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$50', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BVS']
    },
    'bvs': {
        name: 'BVS',
        fullName: 'Branch if Overflow Set',
        description: 'Executes a specific relative branch offset if and only if the processor\'s overflow flag registers as set.',
        flags: [],
        addressingModes: [
            { mode: 'Relative', opcode: '$70', bytes: 2, cycles: '2 (+1 if branch succeeds +2 if to a new page)' }
        ],
        seeAlso: ['BVC']
    },
    'clc': {
        name: 'CLC',
        fullName: 'Clear Carry Flag',
        formula: 'Carry = 0',
        description: 'Forces the processor\'s carry status variable into a cleared out, or zero, condition.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Forced to zero' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$18', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['SEC']
    },
    'cld': {
        name: 'CLD',
        fullName: 'Clear Decimal Mode',
        formula: 'Decimal Mode = 0',
        description: 'Resets the decimal arithmetic mode flag. All subsequent addition and subtraction behaviors revert to binary logic.',
        flags: [
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Forced to zero' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$D8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['SED'],
        notes: 'Since startup conditions for the decimal flag remain undefined across various 6502 iterations, developers customarily issue this directive during initial hardware bootstrap sequences.'
    },
    'cli': {
        name: 'CLI',
        fullName: 'Clear Interrupt Disable',
        formula: 'Interrupts = 0',
        description: 'Disengages the hardware interrupt prevention barrier. Standard interrupt signals will subsequently be captured and handled.',
        flags: [
            { flag: 'I', name: 'Interrupt Disable', description: 'Forced to zero' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$58', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['SEI']
    },
    'clv': {
        name: 'CLV',
        fullName: 'Clear Overflow Flag',
        formula: 'Overflow = 0',
        description: 'Purges the existing state of the processor\'s overflow flag, returning it to a zeroed baseline.',
        flags: [
            { flag: 'V', name: 'Overflow Flag', description: 'Forced to zero' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$B8', bytes: 1, cycles: '2' }
        ]
    },
    'cmp': {
        name: 'CMP',
        fullName: 'Compare',
        formula: 'Accumulator - Memory (Flags Only)',
        description: 'Draws a comparison between the accumulator and a selected memory byte through an uncommitted subtraction. This modifies processor flags without overwriting the accumulator.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Active if Accumulator is greater than or identical to the operand' },
            { flag: 'Z', name: 'Zero Flag', description: 'Active if both values equate perfectly' },
            { flag: 'N', name: 'Negative Flag', description: 'Active if the implied subtraction yields a high-order bit of one' }
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
        formula: 'X Register - Memory (Flags Only)',
        description: 'Evaluates the difference between the X index register and a fetched memory value via silent subtraction, modulating status markers accordingly.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Active if the X register is strictly greater or equal' },
            { flag: 'Z', name: 'Zero Flag', description: 'Active if the register and memory match exactly' },
            { flag: 'N', name: 'Negative Flag', description: 'Active if the highest bit of the virtual subtraction is set' }
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
        formula: 'Y Register - Memory (Flags Only)',
        description: 'Determines the relational status between the Y index register and a target memory byte, updating flags via a non-destructive subtraction.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Active if the Y register meets or exceeds the memory parameter' },
            { flag: 'Z', name: 'Zero Flag', description: 'Active if the two elements are identical' },
            { flag: 'N', name: 'Negative Flag', description: 'Active if the calculation\'s uppermost bit evaluates to one' }
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
        formula: 'Memory = Memory - 1',
        description: 'Reduces the quantitative value contained within a specific memory address by a single unit, recording the resultant zero or negative properties.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Asserted if the decremented total reaches zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Asserted if the adjusted byte triggers the sign bit' }
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
        formula: 'X = X - 1',
        description: 'Subtracts a value of one from the hardware X register. Automatically adjusts flags based on the resulting numerical identity.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Asserted if the variable reaches absolute zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Asserted if the register\'s uppermost bit is active' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$CA', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['DEC', 'DEY']
    },
    'dey': {
        name: 'DEY',
        fullName: 'Decrement Y Register',
        formula: 'Y = Y - 1',
        description: 'Decreases the Y index register by exactly one increment. Processor markings are subsequently tuned to mirror the new state.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Asserted if Y becomes strictly zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Asserted if the value evaluates as a negative sign' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$88', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['DEC', 'DEX']
    },
    'eor': {
        name: 'EOR',
        fullName: 'Exclusive OR',
        formula: 'Accumulator = Accumulator XOR Memory',
        description: 'Applies a bitwise exclusive OR evaluation pairing the accumulator\'s bits against those of a specified memory segment. Matches yield zero, while differences yield one.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Becomes active if the complete evaluation is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Becomes active if bit 7 emerges as a one' }
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
        formula: 'Memory = Memory + 1',
        description: 'Elevates the numerical byte stored at a selected memory index by one step. Evaluates and registers the resulting sign and zero status.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Engaged if the increment wraps directly to zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Engaged if the incremented value sets the eighth bit' }
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
        formula: 'X = X + 1',
        description: 'Increments the X status register\'s stored value by one integer. Processor indicators update to reflect the new mathematical reality.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Turned on if the register rolls over to zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Turned on if the high-order bit activates' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$E8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['INC', 'INY']
    },
    'iny': {
        name: 'INY',
        fullName: 'Increment Y Register',
        formula: 'Y = Y + 1',
        description: 'Advances the current holding of the Y register by a single measure, evaluating the new output against zero and negative constraints.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Enabled once the register resolves to zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Enabled once the most significant bit is triggered' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$C8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['INC', 'INX']
    },
    'jmp': {
        name: 'JMP',
        fullName: 'Jump',
        description: 'Relocates the active execution pointer directly to an explicitly provided memory coordinate, abandoning the sequential instruction path.',
        flags: [],
        addressingModes: [
            { mode: 'Absolute', opcode: '$4C', bytes: 3, cycles: '3' },
            { mode: 'Indirect', opcode: '$6C', bytes: 3, cycles: '5' }
        ],
        notes: 'Historical 6502 hardware exhibits a logic flaw where indirect addresses overlapping a page boundary improperly read the high byte from the start of the page rather than the successive block. Modern iterations like the 65SC02 resolve this, but defensive coding normally avoids edge-of-page indirect jumps entirely.'
    },
    'jsr': {
        name: 'JSR',
        fullName: 'Jump to Subroutine',
        description: 'Transition execution to an external routine. The mechanism stores the current programmatic location (minus a single byte) onto the hardware stack before mutating the execution pointer.',
        flags: [],
        addressingModes: [
            { mode: 'Absolute', opcode: '$20', bytes: 3, cycles: '6' }
        ],
        seeAlso: ['RTS']
    },
    'lda': {
        name: 'LDA',
        fullName: 'Load Accumulator',
        formula: 'Accumulator = Memory',
        description: 'Populates the primary accumulator register using data retrieved from a designated memory access point.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Triggers if the fetched load evaluates to zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Triggers if the retrieved byte possesses an active high bit' }
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
        formula: 'X = Memory',
        description: 'Initializes the X index register with a data parameter pulled from an exact memory boundary.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Activates if the inserted value behaves as a binary zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Activates if the high bit asserts itself as one' }
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
        formula: 'Y = Memory',
        description: 'Assigns the contents of a retrieved memory location directly into the Y processor register.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Sets active if the operation extracts a zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Sets active if the most significant bit denotes negative' }
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
        formula: 'Shift Right (Operand) -> Logic',
        description: 'Migrates every individual bit within the accumulator or target memory byte one position rightward. The vacated uppermost bit is zeroed, while the concluding least significant bit migrates into the processor\'s carry indicator.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Retains the expelled state of bit 0' },
            { flag: 'Z', name: 'Zero Flag', description: 'Asserts if the remaining byte zeroes out' },
            { flag: 'N', name: 'Negative Flag', description: 'Defined universally as zero following the shift' }
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
        description: 'Procures a single cycle increment with no associative processor adjustments. Execution simply progresses onward to the successive operation sequence.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$EA', bytes: 1, cycles: '2' }
        ]
    },
    'ora': {
        name: 'ORA',
        fullName: 'Logical Inclusive OR',
        formula: 'Accumulator = Accumulator OR Memory',
        description: 'Administers a bitwise inclusive OR function, merging the active accumulator memory against an inputted byte pattern.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Signals if the total logical product is zeroed' },
            { flag: 'N', name: 'Negative Flag', description: 'Signals if the merged bit 7 evaluates as active' }
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
        description: 'Deposits a replication of the exact accumulator value straight into the uppermost stack address.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$48', bytes: 1, cycles: '3' }
        ],
        seeAlso: ['PLA']
    },
    'php': {
        name: 'PHP',
        fullName: 'Push Processor Status',
        description: 'Transfers an identical mirror of the processor\'s status flags directly onto the stack layout.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$08', bytes: 1, cycles: '3' }
        ],
        seeAlso: ['PLP']
    },
    'pla': {
        name: 'PLA',
        fullName: 'Pull Accumulator',
        description: 'Retrieves the highest entry from the stack queue and injects it into the accumulator, refreshing state variables in the process.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Triggers if the unspooled stack chunk is zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Triggers if the retrieved negative bit functions as one' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$68', bytes: 1, cycles: '4' }
        ],
        seeAlso: ['PHA']
    },
    'plp': {
        name: 'PLP',
        fullName: 'Pull Processor Status',
        description: 'Extracts an overriding status byte from the hardware stack, overriding the current processor flags to mimic the loaded byte.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Overwritten dynamically mapping to the pulled stack frame' },
            { flag: 'Z', name: 'Zero Flag', description: 'Overwritten dynamically mapping to the pulled stack frame' },
            { flag: 'I', name: 'Interrupt Disable', description: 'Overwritten dynamically mapping to the pulled stack frame' },
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Overwritten dynamically mapping to the pulled stack frame' },
            { flag: 'B', name: 'Break Command', description: 'Overwritten dynamically mapping to the pulled stack frame' },
            { flag: 'V', name: 'Overflow Flag', description: 'Overwritten dynamically mapping to the pulled stack frame' },
            { flag: 'N', name: 'Negative Flag', description: 'Overwritten dynamically mapping to the pulled stack frame' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$28', bytes: 1, cycles: '4' }
        ],
        seeAlso: ['PHP']
    },
    'rol': {
        name: 'ROL',
        fullName: 'Rotate Left',
        description: 'Propels bit elements within the accumulator or memory one slot left. The existing carry variable injects into the newly opened zeroth bit, while the original bit 7 propagates out to replace the carry.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Inherits the discarded upper bit 7' },
            { flag: 'Z', name: 'Zero Flag', description: 'Switches on if the total shifted outcome is null' },
            { flag: 'N', name: 'Negative Flag', description: 'Switches on if the concluding bit 7 is high' }
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
        description: 'Funnel shifts all target bits rightwards by a solitary index. The overarching carry flag occupies the abandoned seventh bit, and the evicted zeroth bit is designated as the new carry.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Consumes the previously held bit 0' },
            { flag: 'Z', name: 'Zero Flag', description: 'Flicks on if the resulting shifted layout matches zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Flicks on if the injected topmost bit measures as one' }
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
        description: 'Signals the completion of an active interrupt handler. The CPU reconstitutes its historical flag layout and program pointer from the stack frame.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Reconstructed entirely based on the stack retrieval pattern' },
            { flag: 'Z', name: 'Zero Flag', description: 'Reconstructed entirely based on the stack retrieval pattern' },
            { flag: 'I', name: 'Interrupt Disable', description: 'Reconstructed entirely based on the stack retrieval pattern' },
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Reconstructed entirely based on the stack retrieval pattern' },
            { flag: 'B', name: 'Break Command', description: 'Reconstructed entirely based on the stack retrieval pattern' },
            { flag: 'V', name: 'Overflow Flag', description: 'Reconstructed entirely based on the stack retrieval pattern' },
            { flag: 'N', name: 'Negative Flag', description: 'Reconstructed entirely based on the stack retrieval pattern' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$40', bytes: 1, cycles: '6' }
        ]
    },
    'rts': {
        name: 'RTS',
        fullName: 'Return from Subroutine',
        description: 'Concludes a previously jumped procedural routine. Evaluates the historical pointer remaining on the stack and advances execution immediately past the origin JSR call.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$60', bytes: 1, cycles: '6' }
        ],
        seeAlso: ['JSR']
    },
    'sbc': {
        name: 'SBC',
        fullName: 'Subtract with Carry',
        formula: 'Accumulator = Accumulator - Memory - !Carry',
        description: 'Performs a mathematical subtraction mapping the accumulator, the target byte, and the inverted carry state. Multi-byte scaling is facilitated by maintaining or dropping the carry.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Evicted if an underflow is observed traversing bit 7' },
            { flag: 'Z', name: 'Zero Flag', description: 'Triggered if the subtraction nets a definitive zero' },
            { flag: 'V', name: 'Overflow Flag', description: 'Triggered if boundary crossing invalidates the mathematical sign' },
            { flag: 'N', name: 'Negative Flag', description: 'Triggered if the seventh bit projects as negative' }
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
        formula: 'Carry = 1',
        description: 'Establishes a firm state of one inside the processor carry flag.',
        flags: [
            { flag: 'C', name: 'Carry Flag', description: 'Inflexibly mapped to one' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$38', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['CLC']
    },
    'sed': {
        name: 'SED',
        fullName: 'Set Decimal Flag',
        formula: 'Decimal = 1',
        description: 'Transitions mathematical hardware into standardized decimal mode mapping, altering the rules of all successive additions or subtractions.',
        flags: [
            { flag: 'D', name: 'Decimal Mode Flag', description: 'Inflexibly mapped to one' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$F8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['CLD']
    },
    'sei': {
        name: 'SEI',
        fullName: 'Set Interrupt Disable',
        formula: 'Interrupts = 1',
        description: 'Commands the processor into a masked interrupt state. Incoming hardware interrupt notifications are queued or dismissed.',
        flags: [
            { flag: 'I', name: 'Interrupt Disable', description: 'Inflexibly mapped to one' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$78', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['CLI']
    },
    'sta': {
        name: 'STA',
        fullName: 'Store Accumulator',
        formula: 'Memory = Accumulator',
        description: 'Writes the explicit contents resting inside the primary accumulator immediately into a target memory register.',
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
        formula: 'Memory = X',
        description: 'Inscribes the X status register\'s data directly into the specified destination boundary.',
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
        formula: 'Memory = Y',
        description: 'Offloads the current state of the Y variable sequentially into the defined memory coordinate.',
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
        formula: 'X = Accumulator',
        description: 'Shuttles the raw data residing in the accumulator over to the X register index, recalculating status monitors accordingly.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Enabled should the incoming data prove zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Enabled should the highest sign bit prove active' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$AA', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TXA']
    },
    'tay': {
        name: 'TAY',
        fullName: 'Transfer Accumulator to Y',
        formula: 'Y = Accumulator',
        description: 'Mirrors the active accumulator payload strictly into the Y index. Evaluates new mathematical properties to format status conditions.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Evaluates positively if the transported load equals zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Evaluates positively if the transferred high bit is logged' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$A8', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TYA']
    },
    'tsx': {
        name: 'TSX',
        fullName: 'Transfer Stack Pointer to X',
        formula: 'X = Stack Pointer',
        description: 'Passes the existing low-level byte address of the hardware stack pointer structurally into the X registry.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Activated if the transferred value amounts to zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Activated if the sign position signifies a one' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$BA', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TXS']
    },
    'txa': {
        name: 'TXA',
        fullName: 'Transfer X to Accumulator',
        formula: 'Accumulator = X',
        description: 'Overwrites the current accumulator state using the numerical parameter nested inside the X index register.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Assigned active if the translated piece zeroes out' },
            { flag: 'N', name: 'Negative Flag', description: 'Assigned active if the new byte holds an upper bit of one' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$8A', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TAX']
    },
    'txs': {
        name: 'TXS',
        fullName: 'Transfer X to Stack Pointer',
        formula: 'Stack Pointer = X',
        description: 'Forcibly resets the internal stack pointer to structurally emulate the active contents of the X registry.',
        flags: [],
        addressingModes: [
            { mode: 'Implied', opcode: '$9A', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TSX']
    },
    'tya': {
        name: 'TYA',
        fullName: 'Transfer Y to Accumulator',
        formula: 'Accumulator = Y',
        description: 'Relays the Y register\'s byte representation strictly to the accumulator variable, altering relevant CPU tracking flags as necessary.',
        flags: [
            { flag: 'Z', name: 'Zero Flag', description: 'Switches to an active condition if the transfer equals zero' },
            { flag: 'N', name: 'Negative Flag', description: 'Switches to an active condition if the high bit resolves high' }
        ],
        addressingModes: [
            { mode: 'Implied', opcode: '$98', bytes: 1, cycles: '2' }
        ],
        seeAlso: ['TAY']
    }
};
