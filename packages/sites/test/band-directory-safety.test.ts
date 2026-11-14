import { expect, it, vi } from 'vitest';
import { BandDirectory } from '../src/band/plan';
import type { GuardedRequest, Surface, SurfaceHost } from '@goltou/surface';
it('allows only the observed Band membership read POST while publication remains blocked', async () => {
  let inspect!: (request: GuardedRequest) => boolean | Promise<boolean>;
  const surface = { guardRequests: vi.fn(async (_rules, guard) => { inspect = guard; }) } as unknown as Surface;
  const host = { create: async () => surface } as unknown as SurfaceHost;
  const directory = new BandDirectory(host);
  await directory.getSurface();
  expect(await inspect({ url: 'https://api-kr.band.us/v2.3.0/get_band_list', method: 'POST' })).toBe(true);
  for(const url of ['https://api-kr.band.us/v2.3.0/get_band_list/extra', 'https://api-kr.band.us/v2.3.0/band/post/create', 'https://api-kr.band.us/v2.3.0/delete_band', 'https://api-kr.band.us.example.invalid/v2.3.0/get_band_list', 'http://api-kr.band.us/v2.3.0/get_band_list']) expect(await inspect({ url, method: 'POST' })).toBe(false);
  expect(await inspect({ url: 'https://api-kr.band.us/v2.3.0/get_band_list', method: 'DELETE' })).toBe(false);
});
