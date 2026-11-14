import { describe, expect, it } from 'vitest';
import { publishResponseShape } from '../../../apps/android/bridge/publish-response-shape';
describe('debug publish response shape only', () => {
  it('records keys, types and lengths without any scalar values', () => {
    const body = JSON.stringify({ isSuccess: true, result: { logNo: '987654321', blogId: 'account-secret', postUrl: 'https://example.invalid/private', title: 'product-secret', token: 'token-secret', data: [123456789, null, { cookie: 'cookie-secret' }] } });
    const shape = publishResponseShape({ status: 200, body });
    const encoded = JSON.stringify(shape);
    for (const content of ['987654321', 'account-secret', 'https:', 'product-secret', 'token-secret', '123456789', 'cookie-secret', 'true']) expect(encoded).not.toContain(content);
    expect(encoded).toContain('logNo'); expect(encoded).toContain('"type":"string","length":9');
    expect(shape.length).toBe(body.length);
  });
  it.each(['unknown-response-secret', '<html>private-data</html>', '{"broken":'])('stores only length for unknown response syntax (%#)', body => {
    expect(publishResponseShape({ status: 200, body }).body).toEqual({ type: 'unparsed', length: body.length });
  });
  it('redacts dynamic field names and bounds large/deep responses', () => {
    const shape = JSON.stringify(publishResponseShape({ status: 200, body: '{"987654321":{"product text":12345,"owneraccount":"secret"}}' }));
    expect(shape).not.toContain('987654321'); expect(shape).not.toContain('product text'); expect(shape).not.toContain('12345');
    expect(shape).not.toContain('owneraccount');
    const nested = 'x'.repeat(1024 * 1024 + 1);
    expect(publishResponseShape({ status: 200, body: nested }).body).toEqual({ type: 'unparsed', length: nested.length });
    expect(JSON.stringify(publishResponseShape({ status: 200, body: JSON.stringify({ data: Array(1000).fill({ secret: 'never-store' }) }) }))).not.toContain('never-store');
  });
});
