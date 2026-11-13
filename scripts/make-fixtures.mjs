import fs from 'node:fs';
import zlib from 'node:zlib';

// Authored test originals, not resized photographs. The portrait makes a fixed
// square thumbnail distinguishable from a source set with one shared ratio.
const crc = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const body = Buffer.concat([Buffer.from(name), data]), result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc(body), body.length + 4); return result;
};
const colours = [[15, 81, 50], [23, 122, 65], [37, 99, 150], [178, 58, 0], [123, 52, 150]];
for (let i = 1; i <= 5; i++) {
  const width = i === 5 ? 180 : 320, height = i === 5 ? 320 : 180, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shape = (x > 30 * i && x < 30 * i + 90 && y > 30 && y < 140) || ((x - 240) ** 2 + (y - 90) ** 2 < 30 ** 2);
    raw.set(shape ? colours[i - 1] : [238, 245, 239], y * (width * 3 + 1) + 1 + x * 3);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  fs.writeFileSync(new URL(`../packages/sites/fixtures/sample-${i}.png`, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
