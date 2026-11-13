import type { Product } from '@goltou/api-client';
import { assemble, parseContents, type ConvertOptions, type InputPlan, type ParsedContent } from './convert';
import { compact, compareDocuments, observePlan, verifyPlan, type Verification } from './verify';
import { applyPolish, polishContent, type PolishResult, type PolishTransport } from './polish';
import { downloadPhotos, type MediaBatch, type MediaDependencies } from './media';

export interface PreparedPreview {
  productNo: number; contentHash: string; options: ConvertOptions; blog: InputPlan; band: InputPlan;
  droppedStruckCharacters: number;
  verification: { blog: Verification; band: Verification }; polish?: PolishResult;
}
export interface PreparationWork {
  readonly preview?: PreparedPreview;
  readonly prepared?: { preview: PreparedPreview; files: import('./media').MediaFile[] } | undefined;
  download(signal: AbortSignal, progress: (n: number) => void): Promise<void>;
  arrange(): Promise<void>;
  cleanup(): Promise<void>;
}
export interface PreparationServices {
  media: MediaDependencies; polish?: PolishTransport;
  ai?: { show(): Promise<void>; hide(): Promise<void>; clear(): Promise<void> };
}
export function makePreview(product: Product, options: ConvertOptions, parsed: ParsedContent = parseContents(product.contentsHtml), polished?: PolishResult, reverted: readonly string[] = []): PreparedPreview {
  const approved = applyPolish(parsed, polished, reverted);
  const blog = assemble(product, 'blog', options, approved), band = assemble(product, 'band', options, approved);
  const verification = {} as PreparedPreview['verification'];
  // Audit unpolished content against HTML independently before applying validated wording changes.
  for (const plan of [blog, band]) {
    const source = verifyPlan(product, assemble(product, plan.channel, options, parsed), options, parsed);
    verification[plan.channel] = source;
    if (source.matches && polished?.paragraphs.some(p => p.accepted && !reverted.includes(p.id))) {
      source.counts.characters = compact(observePlan(plan).text).length;
      source.message += ' · 검증된 문장 다듬기 적용';
    }
  }
  return { productNo: product.productNo, contentHash: product.contentHash, droppedStruckCharacters: parsed.droppedStruckCharacters, options: structuredClone(options), blog, band, verification, ...(polished ? { polish: { ...polished, paragraphs: polished.paragraphs.map(p => ({ ...p, reverted: reverted.includes(p.id) })) } } : {}) };
}
export async function preparePreview(product: Product, options: ConvertOptions & { polish?: boolean }, transport?: PolishTransport): Promise<PreparedPreview> {
  const parsed = parseContents(product.contentsHtml);
  const polished = options.polish ? await polishContent(parsed, product, transport) : undefined;
  return makePreview(product, options, parsed, polished);
}
export function preparationWork(product: Product, preview: PreparedPreview, services: PreparationServices): PreparationWork {
  let batch: MediaBatch | undefined;
  return {
    preview,
    get prepared() { return batch ? { preview, files: batch.files } : undefined; },
    async download(signal, progress) {
      if (batch) { await batch.cleanup(); batch = undefined; }
      const urls = observePlan(preview.blog).photos;
      batch = await downloadPhotos(urls, product.images.map(i => i.url), services.media, signal, progress);
    },
    async arrange() {
      if (!preview.verification.blog.matches || !preview.verification.band.matches) throw new Error('SOURCE_MISMATCH');
      // Rebuild from source and the reviewed per-paragraph decisions at the actual preparation step.
      const rebuilt = makePreview(product, preview.options, undefined, preview.polish, preview.polish?.paragraphs.filter(p => p.reverted).map(p => p.id));
      for (const channel of ['blog', 'band'] as const) if (!compareDocuments(observePlan(rebuilt[channel]), observePlan(preview[channel])).matches) throw new Error('PREPARED_BODY_MISMATCH');
      const expected = observePlan(preview.blog).photos;
      if (!batch || batch.files.length !== expected.length || batch.files.some((f, i) => f.url !== expected[i])) throw new Error('PREPARED_PHOTOS_MISMATCH');
    },
    async cleanup() { if (batch) { await batch.cleanup(); batch = undefined; } },
  };
}
