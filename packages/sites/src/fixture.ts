/** Synthetic text only. No product, price, account or Goltou endpoint. */
export function exampleArticle(id: string) {
  const title = `골투오토 WP0 실험 ${id}`;
  const paragraphs = Array.from({ length: 16 }, (_, index) =>
    `실험 문단 ${String(index + 1).padStart(2, '0')}. 이 글은 골투오토의 입력과 임시저장 상태를 확인하기 위해 만든 가상의 연습 글입니다. 실제 판매 상품이나 여행 일정이 아니며 예약을 받지 않습니다. ` +
    '천천히 글자를 입력하고 문단 사이에 빈 줄을 두어 편집기가 긴 내용을 온전히 보관하는지 살펴봅니다. 예시 그림은 저장소에서 만든 도형이며 실제 골프장이나 숙소의 사진이 아닙니다. ' +
    '저장한 글을 다시 열어 제목과 본문 길이, 문단과 그림의 개수가 같은지 비교합니다. 실험이 끝나도 공개 게시 버튼은 누르지 않습니다.');
  return { title, paragraphs, body: paragraphs.join('\n\n') };
}
