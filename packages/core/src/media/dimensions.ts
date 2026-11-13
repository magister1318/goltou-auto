export interface PixelSize { width: number; height: number }

/** Read encoded pixel dimensions only. Never decode, resize or rewrite the source. */
export function imageDimensions(bytes: Uint8Array): PixelSize {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) => [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const size = (width: number, height: number) => {
    if (!width || !height) throw new Error('PHOTO_DIMENSIONS_UNAVAILABLE');
    return { width, height };
  };
  try {
    if (bytes.length >= 24 && tag(0, '\x89PNG\r\n\x1a\n') && tag(12, 'IHDR')) return size(v.getUint32(16), v.getUint32(20));
    if (tag(0, 'GIF87a') || tag(0, 'GIF89a')) return size(v.getUint16(6, true), v.getUint16(8, true));
    if (tag(0, 'RIFF') && tag(8, 'WEBP')) {
      for (let p = 12; p + 8 <= bytes.length;) {
        const length = v.getUint32(p + 4, true), start = p + 8;
        if (start + length > bytes.length) break;
        if (tag(p, 'VP8X') && length >= 10) return size(1 + (v.getUint32(start + 4, true) & 0xffffff), 1 + (v.getUint32(start + 6, true) >>> 8));
        if (tag(p, 'VP8L') && length >= 5 && bytes[start] === 0x2f) {
          const bits = v.getUint32(start + 1, true);
          return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        }
        if (tag(p, 'VP8 ') && length >= 10 && tag(start + 3, '\x9d\x01\x2a')) return size(v.getUint16(start + 6, true) & 0x3fff, v.getUint16(start + 8, true) & 0x3fff);
        p = start + length + (length & 1);
      }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (let p = 2; p + 3 < bytes.length;) {
        if (bytes[p++] !== 0xff) break;
        while (bytes[p] === 0xff) p++;
        const marker = bytes[p++]!;
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
        const length = v.getUint16(p);
        if (length < 2 || p + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) return size(v.getUint16(p + 5), v.getUint16(p + 3));
        p += length;
      }
    }
  } catch { /* A truncated header is unavailable, never a guessed size. */ }
  throw new Error('PHOTO_DIMENSIONS_UNAVAILABLE');
}
