/** Only fixed error kinds and one-based paragraph positions may reach history. */
export function formattingMessage(code = ''): string | null {
  const match = /^BLOG_FORMATTING_(INPUT|BEFORE_SAVE|AFTER_SAVE|REOPENED|PUBLISHED):([1-9]\d*(?:,[1-9]\d*)*)(?::((?:text|bold|href|cursor|input|number|photo)(?:,(?:text|bold|href|cursor|input|number|photo))*))?$/.exec(code);
  if (!match) return null;
  const names = { text: '본문 글자', bold: '굵기', href: '링크 주소', cursor: '커서 위치', input: '입력 결과', number: '가격 또는 출발일 숫자', photo: '사진 수 또는 순서' };
  const fields = match[3]?.split(',').map(field => names[field as keyof typeof names]).join('·') ?? '굵기·링크';
  return `확인 필요 · ${match[2]!.split(',').join(', ')}번 문단의 ${fields}를 확인해 주세요.`;
}
