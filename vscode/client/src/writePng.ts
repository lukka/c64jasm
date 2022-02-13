import * as zlib from 'zlib';

export function writePng(width: number, height: number, rgba: Buffer): Buffer {
    const crcTable = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            if (c & 1) c = 0xedb88320 ^ (c >>> 1);
            else c = c >>> 1;
        }
        crcTable[i] = c;
    }

    function crc32(buf: Buffer): number {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
            c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        }
        return (c ^ 0xffffffff) >>> 0;
    }

    function createChunk(type: string, data: Buffer): Buffer {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typ = Buffer.from(type, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([typ, data])), 0);
        return Buffer.concat([len, typ, data, crc]);
    }

    const signature = Buffer.from('89504e470d0a1a0a', 'hex');

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type (rgba)
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const ihdrChunk = createChunk('IHDR', ihdr);

    const filtered = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
        filtered[y * (width * 4 + 1)] = 0; // filter type 0
        rgba.copy(filtered, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }

    const idatData = zlib.deflateSync(filtered);
    const idatChunk = createChunk('IDAT', idatData);

    const iendChunk = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}
