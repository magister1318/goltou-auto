import { expect, it } from 'vitest';
import { bandListFailureHint } from '../src/band-list-failure';

it('explains lost Band login and gives one plain retry hint for other failures', () => {
  expect(bandListFailureHint('BAND_LOGIN_LOST')).toBe('밴드 로그인이 풀렸습니다. 설정에서 밴드에 다시 로그인해 주세요.');
  for (const code of ['BAND_HOME_UNRECOGNIZED', 'BAND_LIST_EMPTY', 'BAND_LIST_INCOMPLETE', '']) expect(bandListFailureHint(code)).toBe('잠시 뒤 다시 읽기를 눌러 주세요.');
});
