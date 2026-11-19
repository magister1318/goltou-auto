export function bandListFailureHint(reason: string) {
  return reason === 'BAND_LOGIN_LOST'
    ? '밴드 로그인이 풀렸습니다. 설정에서 밴드에 다시 로그인해 주세요.'
    : '잠시 뒤 다시 읽기를 눌러 주세요.';
}
