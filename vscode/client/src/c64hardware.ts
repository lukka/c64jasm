/**
 * C64 Hardware Register Information
 * Source: https://sta.c64.org/cbm64mem.html
 */

/**
 * Normalize a hex address to lowercase 4-digit format.
 * Examples: $d0 -> $d000, $D000 -> $d000
 */
export function normalizeHexAddress(addr: string): string {
    const lowerAddr = addr.toLowerCase();
    if (lowerAddr.startsWith('$')) {
        const hexDigits = lowerAddr.substring(1);
        return '$' + hexDigits.padStart(4, '0');
    }
    return lowerAddr;
}

export interface HardwareRegister {
    name: string;
    description: string;
    chip: 'VIC-II' | 'SID' | 'CIA1' | 'CIA2';
    access: 'Read' | 'Write' | 'Read/Write';
    bits?: Array<{
        range: string;
        description: string;
    }>;
}

export const c64Hardware: Record<string, HardwareRegister> = {
    // VIC-II registers ($D000-$D3FF)
    '$d000': {
        name: 'SPRITE0_X',
        description: 'Sprite #0 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d001': {
        name: 'SPRITE0_Y',
        description: 'Sprite #0 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d002': {
        name: 'SPRITE1_X',
        description: 'Sprite #1 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d003': {
        name: 'SPRITE1_Y',
        description: 'Sprite #1 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d004': {
        name: 'SPRITE2_X',
        description: 'Sprite #2 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d005': {
        name: 'SPRITE2_Y',
        description: 'Sprite #2 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d006': {
        name: 'SPRITE3_X',
        description: 'Sprite #3 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d007': {
        name: 'SPRITE3_Y',
        description: 'Sprite #3 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d008': {
        name: 'SPRITE4_X',
        description: 'Sprite #4 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d009': {
        name: 'SPRITE4_Y',
        description: 'Sprite #4 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d00a': {
        name: 'SPRITE5_X',
        description: 'Sprite #5 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d00b': {
        name: 'SPRITE5_Y',
        description: 'Sprite #5 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d00c': {
        name: 'SPRITE6_X',
        description: 'Sprite #6 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d00d': {
        name: 'SPRITE6_Y',
        description: 'Sprite #6 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d00e': {
        name: 'SPRITE7_X',
        description: 'Sprite #7 X-coordinate (only bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d00f': {
        name: 'SPRITE7_Y',
        description: 'Sprite #7 Y-coordinate',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d010': {
        name: 'SPRITES_X_MSB',
        description: 'Sprite #0-#7 X-coordinates (bit #8)',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: 'Sprite #x X-coordinate bit #8' }
        ]
    },
    '$d011': {
        name: 'VIC2_CTRL1',
        description: 'Screen control register #1',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bits #0-#2', description: 'Vertical raster scroll' },
            { range: 'Bit #3', description: 'Screen height; 0 = 24 rows; 1 = 25 rows' },
            { range: 'Bit #4', description: '0 = Screen off, complete screen is covered by border; 1 = Screen on, normal screen contents are visible' },
            { range: 'Bit #5', description: '0 = Text mode; 1 = Bitmap mode' },
            { range: 'Bit #6', description: '1 = Extended background mode on' },
            { range: 'Bit #7', description: 'Read: Current raster line (bit #8). Write: Raster line to generate interrupt at (bit #8)' }
        ]
    },
    '$d012': {
        name: 'VIC2_RASTERLINE',
        description: 'Read: Current raster line (bits #0-#7). Write: Raster line to generate interrupt at (bits #0-#7)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d013': {
        name: 'VIC2_STROBE_X',
        description: 'Light pen X-coordinate (bits #1-#8)',
        chip: 'VIC-II',
        access: 'Read'
    },
    '$d014': {
        name: 'VIC2_STROBE_Y',
        description: 'Light pen Y-coordinate',
        chip: 'VIC-II',
        access: 'Read'
    },
    '$d015': {
        name: 'VIC2_SPR_ENABLE',
        description: 'Sprite enable register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '1 = Sprite #x is enabled, drawn onto the screen' }
        ]
    },
    '$d016': {
        name: 'VIC2_CTRL2',
        description: 'Screen control register #2',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bits #0-#2', description: 'Horizontal raster scroll' },
            { range: 'Bit #3', description: 'Screen width; 0 = 38 columns; 1 = 40 columns' },
            { range: 'Bit #4', description: '1 = Multicolor mode on' }
        ]
    },
    '$d017': {
        name: 'VIC2_SPR_EXPANDY',
        description: 'Sprite double height register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '1 = Sprite #x is stretched to double height' }
        ]
    },
    '$d018': {
        name: 'VIC2_ADDR',
        description: 'Memory setup register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bits #1-#3', description: 'In text mode, pointer to character memory (bits #11-#13), relative to VIC bank' },
            { range: 'Bits #4-#7', description: 'Pointer to screen memory (bits #10-#13), relative to VIC bank' }
        ]
    },
    '$d019': {
        name: 'VIC2_IRR',
        description: 'Interrupt status register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '1 = Current raster line is equal to the raster line to generate interrupt at' },
            { range: 'Bit #1', description: '1 = Sprite-background collision occurred' },
            { range: 'Bit #2', description: '1 = Sprite-sprite collision occurred' },
            { range: 'Bit #3', description: '1 = Light pen signal arrived' },
            { range: 'Bit #7', description: '1 = An interrupt event occurred and has not been acknowledged yet' }
        ]
    },
    '$d01a': {
        name: 'VIC2_IMR',
        description: 'Interrupt control register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '1 = Raster interrupt enabled' },
            { range: 'Bit #1', description: '1 = Sprite-background collision interrupt enabled' },
            { range: 'Bit #2', description: '1 = Sprite-sprite collision interrupt enabled' },
            { range: 'Bit #3', description: '1 = Light pen interrupt enabled' }
        ]
    },
    '$d01b': {
        name: 'VIC2_BG_PRIORITY',
        description: 'Sprite priority register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '0 = Sprite #x is drawn in front of screen contents; 1 = Sprite #x is behind screen contents' }
        ]
    },
    '$d01c': {
        name: 'VIC2_SPR_MCOLOUR',
        description: 'Sprite multicolor mode register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '0 = Sprite #x is single color; 1 = Sprite #x is multicolor' }
        ]
    },
    '$d01d': {
        name: 'VIC2_SPR_EXPANDX',
        description: 'Sprite double width register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '1 = Sprite #x is stretched to double width' }
        ]
    },
    '$d01e': {
        name: 'VIC2_SPR_COLL',
        description: 'Sprite-sprite collision register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '1 = Sprite #x collided with another sprite' }
        ]
    },
    '$d01f': {
        name: 'VIC2_SPR_BG_COLL',
        description: 'Sprite-background collision register',
        chip: 'VIC-II',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '1 = Sprite #x collided with background' }
        ]
    },
    '$d020': {
        name: 'VIC2_BORDERCOLOUR',
        description: 'Border color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d021': {
        name: 'VIC2_BGCOLOUR',
        description: 'Background color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d022': {
        name: 'VIC2_BGCOLOUR1',
        description: 'Extra background color #1 (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d023': {
        name: 'VIC2_BGCOLOUR2',
        description: 'Extra background color #2 (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d024': {
        name: 'VIC2_BGCOLOUR3',
        description: 'Extra background color #3 (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d025': {
        name: 'VIC2_SPR_MCOLOUR0',
        description: 'Sprite extra color #1 (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d026': {
        name: 'VIC2_SPR_MCOLOUR1',
        description: 'Sprite extra color #2 (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d027': {
        name: 'VIC2_SPR0_COLOUR',
        description: 'Sprite #0 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d028': {
        name: 'VIC2_SPR1_COLOUR',
        description: 'Sprite #1 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d029': {
        name: 'VIC2_SPR2_COLOUR',
        description: 'Sprite #2 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d02a': {
        name: 'VIC2_SPR3_COLOUR',
        description: 'Sprite #3 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d02b': {
        name: 'VIC2_SPR4_COLOUR',
        description: 'Sprite #4 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d02c': {
        name: 'VIC2_SPR5_COLOUR',
        description: 'Sprite #5 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d02d': {
        name: 'VIC2_SPR6_COLOUR',
        description: 'Sprite #6 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },
    '$d02e': {
        name: 'VIC2_SPR7_COLOUR',
        description: 'Sprite #7 color (only bits #0-#3)',
        chip: 'VIC-II',
        access: 'Read/Write'
    },

    // SID registers ($D400-$D7FF)
    '$d400': {
        name: 'SID_V1_FREQ_LO',
        description: 'Voice #1 frequency (low byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d401': {
        name: 'SID_V1_FREQ_HI',
        description: 'Voice #1 frequency (high byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d402': {
        name: 'SID_V1_PW_LO',
        description: 'Voice #1 pulse width (low byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d403': {
        name: 'SID_V1_PW_HI',
        description: 'Voice #1 pulse width (high byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d404': {
        name: 'SID_V1_CTRL',
        description: 'Voice #1 control register',
        chip: 'SID',
        access: 'Write',
        bits: [
            { range: 'Bit #0', description: '0 = Voice off, Release cycle; 1 = Voice on, Attack-Decay-Sustain cycle' },
            { range: 'Bit #1', description: '1 = Synchronization enabled' },
            { range: 'Bit #2', description: '1 = Ring modulation enabled' },
            { range: 'Bit #3', description: '1 = Disable voice, reset noise generator' },
            { range: 'Bit #4', description: '1 = Triangle waveform enabled' },
            { range: 'Bit #5', description: '1 = Saw waveform enabled' },
            { range: 'Bit #6', description: '1 = Rectangle waveform enabled' },
            { range: 'Bit #7', description: '1 = Noise enabled' }
        ]
    },
    '$d405': {
        name: 'SID_V1_AD',
        description: 'Voice #1 Attack and Decay length',
        chip: 'SID',
        access: 'Write',
        bits: [
            { range: 'Bits #0-#3', description: 'Decay length' },
            { range: 'Bits #4-#7', description: 'Attack length' }
        ]
    },
    '$d406': {
        name: 'SID_V1_SR',
        description: 'Voice #1 Sustain volume and Release length',
        chip: 'SID',
        access: 'Write',
        bits: [
            { range: 'Bits #0-#3', description: 'Release length' },
            { range: 'Bits #4-#7', description: 'Sustain volume' }
        ]
    },
    '$d407': {
        name: 'SID_V2_FREQ_LO',
        description: 'Voice #2 frequency (low byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d408': {
        name: 'SID_V2_FREQ_HI',
        description: 'Voice #2 frequency (high byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d409': {
        name: 'SID_V2_PW_LO',
        description: 'Voice #2 pulse width (low byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d40a': {
        name: 'SID_V2_PW_HI',
        description: 'Voice #2 pulse width (high byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d40b': {
        name: 'SID_V2_CTRL',
        description: 'Voice #2 control register',
        chip: 'SID',
        access: 'Write'
    },
    '$d40c': {
        name: 'SID_V2_AD',
        description: 'Voice #2 Attack and Decay length',
        chip: 'SID',
        access: 'Write'
    },
    '$d40d': {
        name: 'SID_V2_SR',
        description: 'Voice #2 Sustain volume and Release length',
        chip: 'SID',
        access: 'Write'
    },
    '$d40e': {
        name: 'SID_V3_FREQ_LO',
        description: 'Voice #3 frequency (low byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d40f': {
        name: 'SID_V3_FREQ_HI',
        description: 'Voice #3 frequency (high byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d410': {
        name: 'SID_V3_PW_LO',
        description: 'Voice #3 pulse width (low byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d411': {
        name: 'SID_V3_PW_HI',
        description: 'Voice #3 pulse width (high byte)',
        chip: 'SID',
        access: 'Write'
    },
    '$d412': {
        name: 'SID_V3_CTRL',
        description: 'Voice #3 control register',
        chip: 'SID',
        access: 'Write'
    },
    '$d413': {
        name: 'SID_V3_AD',
        description: 'Voice #3 Attack and Decay length',
        chip: 'SID',
        access: 'Write'
    },
    '$d414': {
        name: 'SID_V3_SR',
        description: 'Voice #3 Sustain volume and Release length',
        chip: 'SID',
        access: 'Write'
    },
    '$d415': {
        name: 'SID_FC_LO',
        description: 'Filter cut off frequency (bits #0-#2)',
        chip: 'SID',
        access: 'Write'
    },
    '$d416': {
        name: 'SID_FC_HI',
        description: 'Filter cut off frequency (bits #3-#10)',
        chip: 'SID',
        access: 'Write'
    },
    '$d417': {
        name: 'SID_RES_FILT',
        description: 'Filter control',
        chip: 'SID',
        access: 'Write',
        bits: [
            { range: 'Bit #0', description: '1 = Voice #1 filtered' },
            { range: 'Bit #1', description: '1 = Voice #2 filtered' },
            { range: 'Bit #2', description: '1 = Voice #3 filtered' },
            { range: 'Bit #3', description: '1 = External voice filtered' },
            { range: 'Bits #4-#7', description: 'Filter resonance' }
        ]
    },
    '$d418': {
        name: 'SID_MODE_VOL',
        description: 'Volume and filter modes',
        chip: 'SID',
        access: 'Write',
        bits: [
            { range: 'Bits #0-#3', description: 'Volume' },
            { range: 'Bit #4', description: '1 = Low pass filter enabled' },
            { range: 'Bit #5', description: '1 = Band pass filter enabled' },
            { range: 'Bit #6', description: '1 = High pass filter enabled' },
            { range: 'Bit #7', description: '1 = Voice #3 disabled' }
        ]
    },
    '$d419': {
        name: 'SID_PADDLE_X',
        description: 'X value of paddle selected at memory address $DC00',
        chip: 'SID',
        access: 'Read'
    },
    '$d41a': {
        name: 'SID_PADDLE_Y',
        description: 'Y value of paddle selected at memory address $DC00',
        chip: 'SID',
        access: 'Read'
    },
    '$d41b': {
        name: 'SID_OSC3',
        description: 'Voice #3 waveform output',
        chip: 'SID',
        access: 'Read'
    },
    '$d41c': {
        name: 'SID_ENV3',
        description: 'Voice #3 ADSR output',
        chip: 'SID',
        access: 'Read'
    },

    // CIA#1 registers ($DC00-$DCFF)
    '$dc00': {
        name: 'CIA1_PRA',
        description: 'Port A, keyboard matrix columns and joystick #2',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '0 = Port 2 joystick up pressed' },
            { range: 'Bit #1', description: '0 = Port 2 joystick down pressed' },
            { range: 'Bit #2', description: '0 = Port 2 joystick left pressed' },
            { range: 'Bit #3', description: '0 = Port 2 joystick right pressed' },
            { range: 'Bit #4', description: '0 = Port 2 joystick fire pressed' },
            { range: 'Bits #6-#7', description: 'Paddle selection; %01 = Paddle #1; %10 = Paddle #2' }
        ]
    },
    '$dc01': {
        name: 'CIA1_PRB',
        description: 'Port B, keyboard matrix rows and joystick #1',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '0 = Port 1 joystick up pressed' },
            { range: 'Bit #1', description: '0 = Port 1 joystick down pressed' },
            { range: 'Bit #2', description: '0 = Port 1 joystick left pressed' },
            { range: 'Bit #3', description: '0 = Port 1 joystick right pressed' },
            { range: 'Bit #4', description: '0 = Port 1 joystick fire pressed' }
        ]
    },
    '$dc02': {
        name: 'CIA1_DDRA',
        description: 'Port A data direction register',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '0 = Bit #x in port A can only be read; 1 = Bit #x can be read and written' }
        ]
    },
    '$dc03': {
        name: 'CIA1_DDRB',
        description: 'Port B data direction register',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #x', description: '0 = Bit #x in port B can only be read; 1 = Bit #x can be read and written' }
        ]
    },
    '$dc04': {
        name: 'CIA1_TALO',
        description: 'Timer A (low byte)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc05': {
        name: 'CIA1_TAHI',
        description: 'Timer A (high byte)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc06': {
        name: 'CIA1_TBLO',
        description: 'Timer B (low byte)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc07': {
        name: 'CIA1_TBHI',
        description: 'Timer B (high byte)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc08': {
        name: 'CIA1_TOD10TH',
        description: 'Time of Day, tenth seconds (in BCD)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc09': {
        name: 'CIA1_TODSEC',
        description: 'Time of Day, seconds (in BCD)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc0a': {
        name: 'CIA1_TODMIN',
        description: 'Time of Day, minutes (in BCD)',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc0b': {
        name: 'CIA1_TODHR',
        description: 'Time of Day, hours (in BCD)',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bits #0-#5', description: 'Hours' },
            { range: 'Bit #7', description: '0 = AM; 1 = PM' }
        ]
    },
    '$dc0c': {
        name: 'CIA1_SDR',
        description: 'Serial shift register',
        chip: 'CIA1',
        access: 'Read/Write'
    },
    '$dc0d': {
        name: 'CIA1_ICR',
        description: 'Interrupt control and status register',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '1 = Timer A underflow occurred' },
            { range: 'Bit #1', description: '1 = Timer B underflow occurred' },
            { range: 'Bit #2', description: '1 = TOD is equal to alarm time' },
            { range: 'Bit #3', description: '1 = A complete byte has been received into or sent from serial shift register' },
            { range: 'Bit #4', description: 'Signal level on FLAG pin, datasette input' },
            { range: 'Bit #7', description: 'An interrupt has been generated' }
        ]
    },
    '$dc0e': {
        name: 'CIA1_CRA',
        description: 'Timer A control register',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '0 = Stop timer; 1 = Start timer' },
            { range: 'Bit #1', description: '1 = Indicate timer underflow on port B bit #6' },
            { range: 'Bit #3', description: '0 = Timer restarts upon underflow; 1 = Timer stops upon underflow' },
            { range: 'Bit #4', description: '1 = Load start value into timer' },
            { range: 'Bit #5', description: '0 = Timer counts system cycles; 1 = Timer counts positive edges on CNT pin' },
            { range: 'Bit #7', description: 'TOD speed; 0 = 60 Hz; 1 = 50 Hz' }
        ]
    },
    '$dc0f': {
        name: 'CIA1_CRB',
        description: 'Timer B control register',
        chip: 'CIA1',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '0 = Stop timer; 1 = Start timer' },
            { range: 'Bit #1', description: '1 = Indicate timer underflow on port B bit #7' },
            { range: 'Bit #3', description: '0 = Timer restarts upon underflow; 1 = Timer stops upon underflow' },
            { range: 'Bit #4', description: '1 = Load start value into timer' }
        ]
    },

    // CIA#2 registers ($DD00-$DDFF)
    '$dd00': {
        name: 'CIA2_PRA',
        description: 'Port A, serial bus access',
        chip: 'CIA2',
        access: 'Read/Write',
        bits: [
            { range: 'Bits #0-#1', description: 'VIC bank. %00 = Bank #3 ($C000-$FFFF); %01 = Bank #2 ($8000-$BFFF); %10 = Bank #1 ($4000-$7FFF); %11 = Bank #0 ($0000-$3FFF)' },
            { range: 'Bit #2', description: 'RS232 TXD line, output bit' },
            { range: 'Bit #3', description: 'Serial bus ATN OUT; 0 = High; 1 = Low' },
            { range: 'Bit #4', description: 'Serial bus CLOCK OUT; 0 = High; 1 = Low' },
            { range: 'Bit #5', description: 'Serial bus DATA OUT; 0 = High; 1 = Low' },
            { range: 'Bit #6', description: 'Serial bus CLOCK IN; 0 = Low; 1 = High' },
            { range: 'Bit #7', description: 'Serial bus DATA IN; 0 = Low; 1 = High' }
        ]
    },
    '$dd01': {
        name: 'CIA2_PRB',
        description: 'Port B, RS232 access',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd02': {
        name: 'CIA2_DDRA',
        description: 'Port A data direction register',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd03': {
        name: 'CIA2_DDRB',
        description: 'Port B data direction register',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd04': {
        name: 'CIA2_TALO',
        description: 'Timer A (low byte)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd05': {
        name: 'CIA2_TAHI',
        description: 'Timer A (high byte)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd06': {
        name: 'CIA2_TBLO',
        description: 'Timer B (low byte)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd07': {
        name: 'CIA2_TBHI',
        description: 'Timer B (high byte)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd08': {
        name: 'CIA2_TOD10TH',
        description: 'Time of Day, tenth seconds (in BCD)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd09': {
        name: 'CIA2_TODSEC',
        description: 'Time of Day, seconds (in BCD)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd0a': {
        name: 'CIA2_TODMIN',
        description: 'Time of Day, minutes (in BCD)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd0b': {
        name: 'CIA2_TODHR',
        description: 'Time of Day, hours (in BCD)',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd0c': {
        name: 'CIA2_SDR',
        description: 'Serial shift register',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd0d': {
        name: 'CIA2_ICR',
        description: 'Interrupt control and status register',
        chip: 'CIA2',
        access: 'Read/Write',
        bits: [
            { range: 'Bit #0', description: '1 = Timer A underflow occurred' },
            { range: 'Bit #1', description: '1 = Timer B underflow occurred' },
            { range: 'Bit #2', description: '1 = TOD is equal to alarm time' },
            { range: 'Bit #3', description: '1 = A complete byte has been received into or sent from serial shift register' },
            { range: 'Bit #7', description: 'A non-maskable interrupt has been generated' }
        ]
    },
    '$dd0e': {
        name: 'CIA2_CRA',
        description: 'Timer A control register',
        chip: 'CIA2',
        access: 'Read/Write'
    },
    '$dd0f': {
        name: 'CIA2_CRB',
        description: 'Timer B control register',
        chip: 'CIA2',
        access: 'Read/Write'
    }
};
