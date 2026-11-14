import { describe, expect, it } from 'vitest';
import { draftSaveReceipt, identifySavedDraft } from '../src/naver-blog/draft-identity';
const entry = (stamp: string, id = '') => ({ title: '합성 상품', stamp, id });
describe('saved draft identity', () => {
  it('uses the session response ID even with equal titles and timestamps', () => {
    expect(identifySavedDraft([entry('same', '1')], [entry('same', '1'), entry('same', '2')], '합성 상품', '2')).toEqual({ index: 1, source: 'response-id' });
    expect(identifySavedDraft([], [entry('same', '2'), entry('same', '2')], '합성 상품', '2')).toBeNull();
    expect(identifySavedDraft([], [entry('new', '3')], '합성 상품', '2')).toBeNull();
  });
  it('uses a unique list change without a response ID, never the first or newest equal candidate', () => {
    const before = [entry('old'), entry('older')];
    expect(identifySavedDraft(before, [entry('old'), entry('new'), entry('older')], '합성 상품')).toEqual({ index: 1, source: 'list-change' });
    expect(identifySavedDraft(before, before, '합성 상품')).toBeNull();
    expect(identifySavedDraft(before, [...before, entry('old')], '합성 상품')).toBeNull();
    expect(identifySavedDraft(before, [...before, entry('new'), entry('newer')], '합성 상품')).toBeNull();
    expect(identifySavedDraft([], [entry(''), entry('')], '합성 상품')).toBeNull();
  });
  it('distinguishes a successful receipt without an ID from an unknown or rejected save', () => {
    expect(draftSaveReceipt({ status: 200, body: '{"isSuccess":true,"result":{"logNo":123}}' })).toEqual({ saved: true, id: '123' });
    expect(draftSaveReceipt({ status: 200, body: '{"isSuccess":true,"result":{}}' })).toEqual({ saved: true });
    expect(draftSaveReceipt({ status: 500, body: '{"isSuccess":true}' }).saved).toBe(false);
    expect(draftSaveReceipt({ status: 200, body: '<html>error</html>' }).saved).toBe(false);
    expect(draftSaveReceipt({ status: 200, body: '{"isSuccess":false}' }).saved).toBe(false);
  });
});
