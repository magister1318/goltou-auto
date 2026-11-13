import { describe, expect, it } from 'vitest';
import { imageDimensions } from '../src/media/dimensions';
import { png } from './image-fixture';

describe('source image header dimensions, without decoding or resizing', () => {
  it('reads PNG and both GIF headers', () => {
    expect(imageDimensions(png(140, 90))).toEqual({ width: 140, height: 90 });
    for (const header of ['GIF87a', 'GIF89a']) {
      const b = Buffer.alloc(10); b.write(header); b.writeUInt16LE(640, 6); b.writeUInt16LE(480, 8);
      expect(imageDimensions(b)).toEqual({ width: 640, height: 480 });
    }
  });
  it('walks JPEG segments and reads baseline and progressive SOF', () => {
    for (const marker of [0xc0, 0xc2]) {
      const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, marker, 0, 7, 8, 1, 224, 2, 128]);
      expect(imageDimensions(b)).toEqual({ width: 640, height: 480 });
    }
  });
  it('reads WebP VP8, VP8L and VP8X dimensions', () => {
    const webp = (tag: string, data: Buffer) => {
      const b = Buffer.alloc(20 + data.length); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8); b.write(tag, 12); b.writeUInt32LE(data.length, 16); data.copy(b, 20); return b;
    };
    const extended = Buffer.alloc(10); extended.writeUIntLE(639, 4, 3); extended.writeUIntLE(479, 7, 3);
    const lossy = Buffer.alloc(10); lossy.set([0x9d, 1, 0x2a], 3); lossy.writeUInt16LE(640, 6); lossy.writeUInt16LE(480, 8);
    const lossless = Buffer.alloc(5); lossless[0] = 0x2f; lossless.writeUInt32LE(639 | (479 << 14), 1);
    for (const b of [webp('VP8X', extended), webp('VP8 ', lossy), webp('VP8L', lossless)]) expect(imageDimensions(b)).toEqual({ width: 640, height: 480 });
  });
  it('fails closed for unsupported, truncated and zero-size headers', () => {
    for (const b of [Buffer.alloc(0), Buffer.from('GIF89a'), Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 99]), Buffer.from('not an image'), Buffer.alloc(10)]) expect(() => imageDimensions(b)).toThrow('PHOTO_DIMENSIONS_UNAVAILABLE');
    const b = png(2, 3); b.writeUInt32BE(0, 16); expect(() => imageDimensions(b)).toThrow('PHOTO_DIMENSIONS_UNAVAILABLE');
  });
});
