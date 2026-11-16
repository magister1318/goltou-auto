import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialPreviewOptions } from '../src/polish-setting';
import { PolishStrengthChoice } from '../src/PolishStrengthChoice';

describe('polish strength setting', () => {
  it('defaults to spelling with every optional feature off on each initialization', () => {
    const first = initialPreviewOptions();
    first.polish = true;
    first.polishStrength = 'natural';
    expect(initialPreviewOptions()).toEqual({
      polish: false,
      polishStrength: 'spelling',
      closing: false,
      linkCard: false,
    });
  });
  it.each(['spelling', 'natural'] as const)(
    'shows both plain choices and the selected level: %s',
    (value) => {
      const html = renderToStaticMarkup(
        createElement(PolishStrengthChoice, {
          value,
          disabled: true,
          change: vi.fn(),
        }),
      );
      expect(html).toContain('맞춤법·띄어쓰기만');
      expect(html).toContain('자연스럽게 다듬기');
      expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
      const doc = new JSDOM(html).window.document;
      const selected = doc.querySelector(
        '[role="radio"][aria-checked="true"]',
      )!;
      expect(selected.textContent).toContain(
        value === 'spelling' ? '맞춤법·띄어쓰기만' : '자연스럽게 다듬기',
      );
      expect(selected.hasAttribute('disabled')).toBe(true);
      expect(selected.querySelector('.radio-mark')).not.toBeNull();
      expect(selected.querySelector('small')?.textContent).toBe(
        value === 'spelling'
          ? '틀린 글자와 띄어쓰기만 고칩니다'
          : '어색한 문장도 다듬습니다. 숫자·날짜·가격은 바꾸지 않습니다',
      );
    },
  );
});
