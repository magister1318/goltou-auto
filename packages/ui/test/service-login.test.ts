import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginStrip, ServiceGuide, ServiceLoginList, loginServices, loginLabels } from '../src/ServiceLogin';

const services = { naver: 'confirmed', band: 'expired', ai: 'unknown' } as const;
describe('service login presentation', () => {
  it('offers only Naver and Band in both home and settings', () => {
    expect(loginServices).toEqual(['naver', 'band']);
    for (const html of [renderToStaticMarkup(createElement(LoginStrip, { services, open() {} })), renderToStaticMarkup(createElement(ServiceLoginList, { services, busy: false, open() {}, clear() {} }))]) {
      expect(html).toContain('밴드'); expect(html).toContain('확인됨'); expect(html).toContain('풀림');
      expect(html).not.toMatch(/AI|Google|구글/);
    }
  });
  it.each(loginServices)('explains %s password handling and the way back', service => {
    for (const state of ['confirmed', 'expired', 'unknown', 'checking'] as const) {
      const html = renderToStaticMarkup(createElement(ServiceGuide, { service, state }));
      expect(html).toContain(loginLabels[state]); expect(html).toContain(`login-state ${state}`);
      expect(html).toContain('페이지에만 직접 입력하고 앱은 저장하지 않습니다');
      expect(html).toContain('골투오토로 돌아오기'); expect(html).toContain('골투 서버로 보내지 않습니다');
      expect(html).toContain('자동으로 돌아옵니다'); expect(html).toContain('취소할 때만');
      expect(html).not.toMatch(/가짜|시뮬레이션|여기에 열립니다/);
    }
  });
});
