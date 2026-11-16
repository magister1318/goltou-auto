/** Only fixed error kinds and one-based paragraph positions may reach history. */
export function formattingMessage(code = ''): string | null {
  const match = /^BLOG_FORMATTING_(INPUT|BEFORE_SAVE|AFTER_SAVE|REOPENED|PUBLISHED):([1-9]\d*(?:,[1-9]\d*)*)$/.exec(code);
  if (!match) return null;
  return `확인 필요 · ${match[2]!.split(',').join(', ')}번 문단의 굵기·링크를 확인해 주세요.`;
}
