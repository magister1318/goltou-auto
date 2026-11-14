import { describe, expect, it } from 'vitest';
import { publishProbeShape } from '../../../apps/android/bridge/publish-probe';
import { jsonNode, requestFields, walkFields } from '../../sites/src/naver-blog/request-fields';

describe('shape-only publish probe', () => {
  it('keeps only field shapes and short visibility values, including nested JSON and duplicates', () => {
    const postData = new URLSearchParams({ title: 'SENSITIVE_TITLE', blogId: 'ACCOUNT', body: JSON.stringify({ text: 'SECRET_BODY', photoUrl: 'https://secret.invalid', scopeId: 'ID123', openType: '0', configuration: JSON.stringify({ private: true, visibility: 'LONG_PRIVATE_TEXT', scope: 'short' }) }), token: 'TOKEN' }).toString() + '&openType=2&openType=0';
    const shape = publishProbeShape({ url: 'https://blog.naver.com/RabbitWrite.naver?secret=NEVER', method: 'POST', contentType: 'application/x-www-form-urlencoded', postData, postDataInline: false, postDataFetched: true, postDataComplete: true, hasPostData: true }, undefined);
    expect(shape.request.fields).toContainEqual({ name: 'title', length: 15, json: false });
    expect(shape.request.candidates.filter(c => c.path.join('.') === 'openType').map(c => c.value)).toEqual(['2', '0']);
    expect(shape.request.candidates.find(c => c.path.join('.') === 'body.configuration.private')).toMatchObject({ type: 'boolean' });
    const serialized = JSON.stringify(shape);
    for (const secret of ['SENSITIVE_TITLE', 'ACCOUNT', 'SECRET_BODY', 'https://secret', 'ID123', 'LONG_PRIVATE_TEXT', 'TOKEN', 'NEVER']) expect(serialized).not.toContain(secret);
    expect(shape.request.fetchMethod).toBe('Network.getRequestPostData');
  });
  it('preserves duplicate JSON keys and walks arrays and embedded JSON to depth eight', () => {
    const node = jsonNode('{"openType":0,"openType":2,"array":[{"scope":"private"}]}');
    expect(node.entries?.map(([key]) => key)).toEqual(['openType', 'openType', 'array']);
    const entries: string[] = [];
    walkFields(node.entries!, field => entries.push(field.path.join('.')));
    expect(entries).toContain('array.0.scope');
    const nested = 'openType';
    const value = Object.fromEntries([[nested, false]]);
    const shape = publishProbeShape({ url: '', method: 'POST', contentType: 'application/json', postData: JSON.stringify({ a: { b: { c: { d: { e: { f: { g: { h: value } } } } } } } }) }, undefined);
    expect(shape.request.candidates).toContainEqual({ path: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'openType'], type: 'boolean', length: 5, value: false });
  });
  it('reads complete multipart shapes without persisting boundaries, headers or text', () => {
    const postData = '--SENSITIVE_BOUNDARY\r\nContent-Disposition: form-data; name="openType"\r\n\r\n0\r\n--SENSITIVE_BOUNDARY--\r\n';
    const shape = publishProbeShape({ url: '', method: 'POST', contentType: 'multipart/form-data; boundary=SENSITIVE_BOUNDARY', postData }, undefined);
    expect(shape.request).toMatchObject({ encoding: 'multipart', parsed: true, candidates: [{ path: ['openType'], value: '0', type: 'string', length: 1 }] });
    expect(JSON.stringify(shape)).not.toContain('SENSITIVE_BOUNDARY');
    expect(() => requestFields({ url: '', method: 'POST', contentType: 'multipart/form-data; boundary=SENSITIVE_BOUNDARY', postData: postData.slice(0, -10) })).toThrow();
  });
  it('records missing bodies as unavailable without inventing evidence', () => {
    const shape = publishProbeShape({ url: '', method: 'POST', hasPostData: true, postDataComplete: false }, undefined);
    expect(shape.request).toMatchObject({ hasPostData: true, complete: false, parsed: false, length: null, candidates: [] });
  });
});
