import { describe, expect, it } from 'vitest';
import type { Surface } from '@goltou/surface';
import { click } from '../src/dom';
import { ControlNotFoundError, safeFailureCode } from '../src/control-failure';

describe('content-free control diagnostics', () => {
  it('identifies a lookup outside a plan without including its selector or exact text', async () => {
    await expect(click({} as Surface, 'BLOG_DRAFT_ITEM', '[data-private-selector]', 'PRIVATE-TITLE', 0))
      .rejects.toThrow('CONTROL_NOT_FOUND:BLOG_DRAFT_ITEM:NONE:0');
  });
  it('keeps only a fixed kind and one-based plan position, never an arbitrary role', () => {
    const missing = new ControlNotFoundError('BLOG_TAG_INPUT');
    expect(safeFailureCode(missing.atPlanStep(97, { kind: 'text', role: 'hashtags' }), 'BLOG_FAILED')).toBe('CONTROL_NOT_FOUND:BLOG_TAG_INPUT:TEXT_HASHTAGS:97');
    expect(safeFailureCode(missing.atPlanStep(12, { kind: 'text', role: 'PRIVATE-BODY' }), 'BLOG_FAILED')).toBe('CONTROL_NOT_FOUND:BLOG_TAG_INPUT:TEXT:12');
    expect(safeFailureCode(missing.atPlanStep(13, { kind: 'photos' }), 'BLOG_FAILED')).toBe('CONTROL_NOT_FOUND:BLOG_TAG_INPUT:PHOTOS:13');
  });
  it('rejects spoofed diagnostic strings and still accepts existing fixed readback codes', () => {
    expect(safeFailureCode(new Error('CONTROL_NOT_FOUND:BLOG_TAG_INPUT:PRIVATE:97'), 'BLOG_FAILED')).toBe('BLOG_FAILED');
    expect(safeFailureCode(new Error('https://example.invalid/PRIVATE'), 'CHANNEL_FAILED')).toBe('CHANNEL_FAILED');
    expect(safeFailureCode(new Error('BLOG_READBACK_MISMATCH:text,photos'), 'BLOG_FAILED')).toBe('BLOG_READBACK_MISMATCH:text,photos');
    expect(() => new ControlNotFoundError('BLOG_BODY', 'TEXT', -1)).toThrow('INVALID_CONTROL_DIAGNOSTIC');
  });
});
