export interface PhotoSize { width: number; height: number }
export interface PhotoSlot extends PhotoSize { signature: string; loaded: boolean }
export interface PhotoProof { urls: string[]; ratio: 'matched' | 'unavailable'; counts: number[]; sources: PhotoSize[]; thumbnails: PhotoSize[] }
const mismatch = () => { throw new Error('BAND_READBACK_MISMATCH:photos'); };
// Relative 2% allows integer thumbnail rounding without accepting a changed shape.
const closeRatio = (a: number, b: number) => Math.abs(a / b - 1) <= 0.02;

/** This ledger belongs to one composer, and never infers identity from a count alone. */
export class PhotoOrder {
  private slots: PhotoSlot[] = [];
  private failed = false;
  constructor(readonly urls: string[], readonly sources: PhotoSize[]) {}
  fail(): never { this.failed = true; return mismatch(); }
  check(slots: PhotoSlot[], attaching = false) {
    if (this.failed || slots.length < this.slots.length || slots.length > this.slots.length + (attaching ? 1 : 0)) this.fail();
    if (this.slots.some((s, i) => s.signature !== slots[i]?.signature)) this.fail();
  }
  commit(slots: PhotoSlot[]) {
    this.check(slots, true);
    if (slots.length !== this.slots.length + 1 || slots.some(s => !s.loaded || !s.signature || !s.width || !s.height)) this.fail();
    this.slots = structuredClone(slots);
  }
  prove(slots: PhotoSlot[]): PhotoProof {
    this.check(slots);
    if (slots.length !== this.urls.length || this.slots.length !== this.urls.length || this.sources.length !== this.urls.length) this.fail();
    const sources = this.sources.map(s => s.width / s.height), ratios = slots.map(s => s.width / s.height);
    if (ratios.some(r => !Number.isFinite(r) || r <= 0) || sources.some(r => !Number.isFinite(r) || r <= 0)) this.fail();
    const cropped = ratios.length > 1 && ratios.every(r => closeRatio(r, ratios[0]!)) && sources.some(r => !closeRatio(r, sources[0]!));
    if (!cropped && ratios.some((r, i) => !closeRatio(r, sources[i]!))) this.fail();
    return { urls: [...this.urls], ratio: cropped ? 'unavailable' : 'matched', counts: this.slots.map((_, i) => i + 1),
      sources: structuredClone(this.sources), thumbnails: slots.map(({ width, height }) => ({ width, height })) };
  }
}
