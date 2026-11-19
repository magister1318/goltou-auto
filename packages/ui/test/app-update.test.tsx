import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UpdateSnapshot } from '@goltou/core/app-update';
vi.mock('../src/store', () => ({ request: vi.fn(async () => ({})) }));
import { UpdateNotice, UpdateSettings, UpdateSheet } from '../src/AppUpdate';
const value: UpdateSnapshot = { current: '1.0.4 (8)', phase: 'available', release: { version: '1.0.5', date: '2026-11-20', size: 56124432 }, notice: true, sheet: true, bytes: 0, percent: 0 };
describe('update UI', () => {
  it('shows the plain home line only when the policy allows it', () => {
    expect(renderToStaticMarkup(createElement(UpdateNotice, { value }))).toContain('새 버전 1.0.5가 있습니다');
    expect(renderToStaticMarkup(createElement(UpdateNotice, { value: { ...value, notice: false } }))).toBe('');
  });
  it('shows current version, server date, decimal MB and both actions', () => {
    const html = renderToStaticMarkup(createElement(UpdateSheet, { value }));
    for (const text of ['새 버전 1.0.5', '1.0.4 (8)', '2026-11-20', '56.1MB', '나중에', '업데이트', '로그인은 그대로 남습니다']) expect(html).toContain(text);
    expect(html).toContain('role="alertdialog"');
  });
  it('shows progress with cancel as the only button', () => {
    const html = renderToStaticMarkup(createElement(UpdateSheet, { value: { ...value, phase: 'downloading', bytes: 12300000, percent: 21 } }));
    expect(html).toContain('12.3MB'); expect(html).toContain('21%'); expect(html).toContain('<progress'); expect(html).toContain('취소');
    expect(html.match(/<button/g)).toHaveLength(1); expect(html).not.toContain('나중에');
  });
  it('shows permission guidance and settings action', () => {
    const html = renderToStaticMarkup(createElement(UpdateSheet, { value: { ...value, phase: 'permission' } }));
    expect(html).toContain('설치 허용이 한 번 필요합니다'); expect(html).toContain('설정 열기'); expect(html).toContain('돌아오면 바로 이어서 설치합니다');
  });
  it('uses generic verification failure and no reason/token on the screen', () => {
    const html = renderToStaticMarkup(createElement(UpdateSheet, { value: { ...value, phase: 'error' } }));
    expect(html).toContain('업데이트 파일을 확인하지 못했습니다. 잠시 뒤 다시 해 주세요.'); expect(html).not.toContain('UPDATE_');
  });
  it.each(['idle', 'checking', 'available'] as const)('shows settings status %s', phase => {
    const html = renderToStaticMarkup(createElement(UpdateSettings, { current: '1.0.4 (8)', disabled: false, value: { ...value, phase, ...(phase === 'idle' ? { release: undefined } : {}) } as UpdateSnapshot }));
    expect(html).toContain('앱 버전 1.0.4 (8)');
    expect(html).toContain(phase === 'checking' ? '확인 중' : phase === 'idle' ? '최신입니다' : '새 버전 1.0.5 있음');
  });
});
