import { trace, type ReasonCode, type ComparisonCounts } from '@goltou/surface/telemetry';

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
  fail(reason: ReasonCode, counts: ComparisonCounts, check: 'photos' | 'photo_order' | 'photo_ratio' = 'photos'): never {
    this.failed = true;
    trace('verification', 'fail', { check, reason, counts });
    return mismatch();
  }
  check(slots: PhotoSlot[], attaching = false) {
    if (this.failed) this.fail('PHOTO_UPLOAD_PROOF_INVALID', { expected: 1, observed: 0 });
    const maximum = this.slots.length + (attaching ? 1 : 0);
    if (slots.length < this.slots.length || slots.length > maximum) {
      this.fail('PHOTO_COUNT_MISMATCH', { expected: slots.length < this.slots.length ? this.slots.length : maximum, observed: slots.length });
    }
    const index = this.slots.findIndex((s, i) => s.signature !== slots[i]?.signature);
    if (index >= 0) this.fail('PHOTO_UPLOAD_SLOT_CHANGED', { expected: 1, observed: 0, photoIndex: index + 1 }, 'photo_order');
  }
  commit(slots: PhotoSlot[]) {
    this.check(slots, true);
    if (slots.length !== this.slots.length + 1) this.fail('PHOTO_COUNT_MISMATCH', { expected: this.slots.length + 1, observed: slots.length });
    const ready = slots.filter(s => s.loaded && s.signature && s.width && s.height).length;
    if (ready !== slots.length) this.fail('PHOTO_UPLOAD_NOT_SETTLED', { expected: slots.length, observed: ready });
    this.slots = structuredClone(slots);
  }
  prove(slots: PhotoSlot[]): PhotoProof {
    this.check(slots);
    const count = [slots.length, this.slots.length, this.sources.length].find(value => value !== this.urls.length);
    if (count !== undefined) this.fail('PHOTO_COUNT_MISMATCH', { expected: this.urls.length, observed: count });
    const sources = this.sources.map(s => s.width / s.height), ratios = slots.map(s => s.width / s.height);
    const valid = (ratio: number) => Number.isFinite(ratio) && ratio > 0;
    const invalid = ratios.findIndex((ratio, i) => !valid(ratio) || !valid(sources[i]!));
    if (invalid >= 0) this.fail('PHOTO_RATIO_UNREADABLE', {
      expected: Number(valid(sources[invalid]!)), observed: Number(valid(ratios[invalid]!)), photoIndex: invalid + 1,
    }, 'photo_ratio');
    const cropped = ratios.length > 1 && ratios.every(r => closeRatio(r, ratios[0]!)) && sources.some(r => !closeRatio(r, sources[0]!));
    const changed = cropped ? -1 : ratios.findIndex((ratio, i) => !closeRatio(ratio, sources[i]!));
    if (changed >= 0) this.fail('PHOTO_RATIO_MISMATCH', {
      expected: Math.round(sources[changed]! * 1000), observed: Math.round(ratios[changed]! * 1000), photoIndex: changed + 1,
    }, 'photo_ratio');
    return { urls: [...this.urls], ratio: cropped ? 'unavailable' : 'matched', counts: this.slots.map((_, i) => i + 1),
      sources: structuredClone(this.sources), thumbnails: slots.map(({ width, height }) => ({ width, height })) };
  }
}
