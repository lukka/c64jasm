#!/usr/bin/env node
// A small VICE binary-monitor peer for testing the actual process/transport
// boundaries without requiring an emulator window or platform ROM files.
const net = require('node:net');
const fs = require('node:fs');
const options = fs.existsSync('vice-fixture.json') ? JSON.parse(fs.readFileSync('vice-fixture.json', 'utf8')) : {};
const address = process.argv[process.argv.indexOf('-binarymonitoraddress') + 1];
const [host, port] = address.split(':');
const memory = Buffer.alloc(65536);
memory[0xdd00] = 3;
memory[0xd018] = 0x14;
const names = ['PC', 'A', 'X', 'Y', 'SP', 'FL'];
const registers = [0x080d, 0, 0, 0, 0xff, 0x20];
const checkpoints = new Map();
let checkpointId = 0;
const sockets = new Set();
const timers = new Set();
let stepTimer;
let closed = false;
fs.writeFileSync('vice.pid', String(process.pid));

function schedule(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
}

function word(value) {
    const result = Buffer.alloc(2);
    result.writeUInt16LE(value);
    return result;
}

function response(socket, type, id, body = Buffer.alloc(0), code = 0) {
    const header = Buffer.alloc(12);
    header[0] = header[1] = 2;
    header.writeUInt32LE(body.length, 2);
    header[6] = type;
    header[7] = code;
    header.writeUInt32LE(id, 8);
    socket.write(Buffer.concat([header, body]));
}

function registerBody() {
    return Buffer.concat([word(registers.length), ...registers.map((value, id) => Buffer.concat([Buffer.from([3, id]), word(value)]))]);
}

function stopped(socket) {
    response(socket, 0x31, 0xffffffff, registerBody());
    response(socket, 0x62, 0xffffffff, word(registers[0]));
}

function shutdown() {
    if (closed) return;
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    server.close(() => {});
}

const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('data', data => {
        pending = Buffer.concat([pending, data]);
        while (pending.length >= 11 && pending.length >= 11 + pending.readUInt32LE(2)) {
            const size = 11 + pending.readUInt32LE(2);
            const frame = pending.subarray(0, size);
            pending = pending.subarray(size);
            const id = frame.readUInt32LE(6);
            const type = frame[10];
            const body = frame.subarray(11);
            switch (type) {
                case 0x85: response(socket, type, id, Buffer.from([2, 3, 10, 1, 48])); break;
                case 0x83:
                    response(socket, type, id, Buffer.concat([word(names.length), ...names.map((name, index) =>
                        Buffer.concat([Buffer.from([3 + name.length, index, index === 0 ? 16 : 8, name.length]), Buffer.from(name)]))]));
                    break;
                case 0x31:
                    if (stepTimer) {
                        clearTimeout(stepTimer);
                        timers.delete(stepTimer);
                        stepTimer = undefined;
                    }
                    response(socket, type, id, registerBody());
                    stopped(socket);
                    break;
                case 0x32:
                    registers[body[4]] = body.readUInt16LE(5);
                    response(socket, 0x31, id, registerBody());
                    break;
                case 0x01: {
                    const start = body.readUInt16LE(1);
                    if (start === options.rejectMemoryAt) {
                        response(socket, 0, id, Buffer.alloc(0), 2); // MEMSPACE_INVALID
                        break;
                    }
                    if (start === options.malformedMemoryAt) {
                        response(socket, type, id, Buffer.alloc(1)); // Missing length word
                        break;
                    }
                    const bytes = memory.subarray(body.readUInt16LE(1), body.readUInt16LE(3) + 1);
                    response(socket, type, id, Buffer.concat([word(bytes.length), bytes]));
                    break;
                }
                case 0x02:
                    body.copy(memory, body.readUInt16LE(1), 8);
                    response(socket, type, id);
                    break;
                case 0x12: {
                    const info = Buffer.alloc(23);
                    info.writeUInt32LE(++checkpointId);
                    body.copy(info, 5, 0, 4);
                    info[9] = info[10] = 1;
                    info[11] = 4;
                    checkpoints.set(checkpointId, info);
                    fs.writeFileSync('checkpoints.json', JSON.stringify([...checkpoints.keys()]));
                    response(socket, 0x11, id, info);
                    break;
                }
                case 0x13:
                    checkpoints.delete(body.readUInt32LE());
                    fs.writeFileSync('checkpoints.json', JSON.stringify([...checkpoints.keys()]));
                    response(socket, type, id);
                    break;
                case 0x14:
                    for (const checkpoint of checkpoints.values()) response(socket, 0x11, id, checkpoint);
                    response(socket, type, id, word(checkpoints.size));
                    break;
                case 0x22: response(socket, type, id, Buffer.alloc(0), options.rejectCondition ? 0x81 : 0); break;
                case 0xdd: {
                    const program = fs.readFileSync(body.subarray(4, 4 + body[3]).toString());
                    program.copy(memory, program.readUInt16LE(), 2);
                    registers[0] = 0x080d;
                    response(socket, type, id);
                    stopped(socket);
                    break;
                }
                case 0xaa:
                    response(socket, type, id);
                    response(socket, 0x63, 0xffffffff, word(registers[0]));
                    break;
                case 0x71: case 0x73:
                    registers[0] += 2;
                    fs.writeFileSync('step.started', 'yes');
                    response(socket, type, id);
                    if (options.stepDelayMs) {
                        stepTimer = schedule(() => {
                            stepTimer = undefined;
                            fs.writeFileSync('step.done', 'yes');
                            stopped(socket);
                        }, options.stepDelayMs);
                    } else stopped(socket);
                    break;
                case 0x84: {
                    const image = Buffer.alloc(25);
                    image.writeUInt32LE(13);
                    image.writeUInt16LE(2, 4);
                    image.writeUInt16LE(2, 6);
                    image[16] = 8;
                    image.writeUInt32LE(4, 17);
                    image.set([0, 1, 2, 3], 21);
                    if (options.screenshotDelayMs) schedule(() => response(socket, type, id, image), options.screenshotDelayMs);
                    else response(socket, type, id, image);
                    break;
                }
                case 0xbb: shutdown(); break;
                default: throw new Error(`Unexpected VICE request 0x${type.toString(16)}`);
            }
        }
    });
});
process.on('SIGTERM', shutdown);
if (options.startupDelayMs) schedule(() => server.listen(Number(port), host), options.startupDelayMs);
else server.listen(Number(port), host);
