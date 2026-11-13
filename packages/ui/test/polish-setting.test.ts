import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialPreviewOptions } from '../src/polish-setting';
import { PolishStrengthChoice } from '../src/PolishStrengthChoice';

describe('polish strength setting', () => {
  it('defaults to natural with every optional feature off on each initialization', () => {
    const first = initialPreviewOptions(); first.polish = true; first.polishStrength = 'spelling';
    expect(initialPreviewOptions()).toEqual({ polish: false, polishStrength: 'natural', closing: false, linkCard: false });
  });
  it.each(['spelling', 'natural'] as const)('shows both plain choices and the selected level: %s', value => {
    const html = renderToStaticMarkup(createElement(PolishStrengthChoice, { value, disabled: true, change: vi.fn() }));
    expect(html).toContain('맞춤법·띄어쓰기만'); expect(html).toContain('자연스럽게 다듬기');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain(`aria-checked="true" class="chosen" disabled="">${value === 'spelling' ? '맞춤법·띄어쓰기만' : '자연스럽게 다듬기'}`);
  });
});
