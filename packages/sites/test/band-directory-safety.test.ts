import { expect, it, vi } from 'vitest';
import { BandDirectory } from '../src/band/plan';
import type { GuardedRequest, GuardedResponse, Surface, SurfaceHost } from '@goltou/surface';
it('allows only the observed Band membership read POST while publication remains blocked', async () => {
  let inspect!: (request: GuardedRequest) => boolean | Promise<boolean>;
  const surface = { guardRequests: vi.fn(async (_rules, guard) => { inspect = guard; }) } as unknown as Surface;
  const host = { create: async () => surface } as unknown as SurfaceHost;
  const directory = new BandDirectory(host);
  await directory.getSurface();
  expect(await inspect({ url: 'https://api-kr.band.us/v2.3.0/get_band_list', method: 'POST' })).toBe(true);
  expect(await inspect({ url: 'https://up.band.us/v3/upload_photo', method: 'POST' })).toBe(true);
  for (const url of ['https://up.band.us/v3/upload_photo/extra', 'https://up.band.us/v3/upload_video', 'https://up.band.us/v3/band/post/create', 'https://up.band.us.example.invalid/v3/upload_photo', 'http://up.band.us/v3/upload_photo']) expect(await inspect({ url, method: 'POST' })).toBe(false);
  expect(await inspect({ url: 'https://up.band.us/v3/upload_photo', method: 'DELETE' })).toBe(false);
  for(const url of ['https://api-kr.band.us/v2.3.0/get_band_list/extra', 'https://api-kr.band.us/v2.3.0/band/post/create', 'https://api-kr.band.us/v2.3.0/delete_band', 'https://api-kr.band.us.example.invalid/v2.3.0/get_band_list', 'http://api-kr.band.us/v2.3.0/get_band_list']) expect(await inspect({ url, method: 'POST' })).toBe(false);
  expect(await inspect({ url: 'https://api-kr.band.us/v2.3.0/get_band_list', method: 'DELETE' })).toBe(false);
});

it.each(['application/json', 'application/x-www-form-urlencoded'])('guards the observed mobile create route with one armed target and response proof (%s)', async contentType => {
  let inspect!: (request: GuardedRequest) => boolean | Promise<boolean>;
  let response!: (value: GuardedResponse) => void;
  let observes!: (request: Pick<GuardedRequest, 'url' | 'method'>) => boolean;
  const surface = { guardRequests: vi.fn(async (_rules, guard, reply, observe) => { inspect = guard; response = reply; observes = observe; }) } as unknown as Surface;
  const directory = new BandDirectory({ create: async () => surface } as unknown as SurfaceHost);
  await directory.getSurface();
  const url = 'https://api-kr.band.us/v2.0.2/create_post';
  const request = (key = '111', complete = true): GuardedRequest => ({
    url, method: 'POST', contentType, postDataComplete: complete,
    postData: contentType === 'application/json' ? JSON.stringify({ band_key: key }) : `band_key=${key}`,
  });
  expect(await inspect(request())).toBe(false);
  directory.arm('111');
  expect(await inspect(request('222'))).toBe(false);
  expect(await inspect(request('111', false))).toBe(false);
  for (const other of ['https://api-kr.band.us/v2.0.3/create_post', 'https://api-kr.band.us/v2.0.2/create_post/extra', 'https://other.band.us/v2.0.2/create_post', 'http://api-kr.band.us/v2.0.2/create_post']) expect(await inspect({ ...request(), url: other })).toBe(false);
  expect(await inspect(request())).toBe(true);
  expect(await inspect(request())).toBe(false);
  expect(directory.submitted('111')).toBe(false);
  expect(observes({ url, method: 'POST' })).toBe(true);
  response({ url, method: 'POST', status: 200, body: JSON.stringify({ result_code: 1, result_data: { post_key: '9001' } }) });
  expect(directory.submitted('111')).toBe(true);
  expect(directory.matchesPost('https://band.us/band/111/post/9001')).toBe(true);
  expect(directory.submitted('222')).toBe(false);
});
