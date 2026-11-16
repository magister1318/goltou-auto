import type { InputPlan } from '@goltou/core';
import { bandText, photoUrls } from '@goltou/sites';
import { ProductPhoto } from './ProductPhoto';
const safeLink = (href: string) => {
  try {
    return ['https:', 'http:', 'tel:', 'mailto:'].includes(
      new URL(href).protocol,
    )
      ? href
      : undefined;
  } catch {
    return undefined;
  }
};
export function sourcePhotoRatios(html: string): Record<string, number> {
  if (typeof DOMParser === 'undefined') return {};
  return Object.fromEntries(
    [
      ...new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelectorAll('img'),
    ].flatMap((img) => {
      const width = Number(img.getAttribute('width')),
        height = Number(img.getAttribute('height'));
      return width > 0 && height > 0
        ? [[img.getAttribute('src') ?? '', width / height]]
        : [];
    }),
  );
}
export function ConversionPreview({
  plan,
  expanded,
  droppedStruckCharacters,
  ratios = {},
  bandName,
}: {
  plan: InputPlan;
  expanded: boolean;
  droppedStruckCharacters: number;
  ratios?: Record<string, number>;
  bandName?: string | undefined;
}) {
  const visible = expanded ? plan.steps : plan.steps.slice(0, 8);
  const photos = photoUrls(plan);
  const tags = plan.steps.flatMap((s) =>
    s.kind === 'text' && s.role === 'hashtags'
      ? s.text.split(/\s+/).filter(Boolean)
      : [],
  );
  return (
    <>
      <div className={`converted-content service-post ${plan.channel}`}>
        <div className="post-caption">
          <span>{plan.channel === 'blog' ? '블로그 글' : '밴드 글'}</span>
          {plan.channel === 'band' && <span>{bandName || '밴드를 고르면 이름이 나옵니다'}</span>}
        </div>
        {plan.channel === 'band' ? (
          <>
            <div className="band-text">{bandText(plan)}</div>
            <div className="band-photo-grid">
              {photos.map((url, i) => (
                <ProductPhoto
                  key={`${i}:${url}`}
                  url={url}
                  preview
                  ratio={ratios[url]}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="post-body">
              {visible.map((step, i) => {
                if (step.kind === 'break') return null;
                if (step.kind === 'photos')
                  return (
                    <div className="preview-photos" key={i}>
                      {step.urls.map((url, n) => (
                        <figure key={`${n}:${url}`}>
                          <ProductPhoto url={url} preview ratio={ratios[url]} />
                        </figure>
                      ))}
                    </div>
                  );
                if (step.kind === 'table')
                  return (
                    <div
                      className="table-scroll"
                      key={i}
                      tabIndex={0}
                      aria-label="표, 좌우로 밀어 보기"
                    >
                      <table>
                        <thead>
                          <tr>
                            {step.rows[0]?.map((cell, c) => (
                              <th key={c} scope="col">
                                {cell}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {step.rows.slice(1).map((row, r) => (
                            <tr key={r}>
                              {row.map((cell, c) => (
                                <td key={c}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                if (step.role === 'hashtags') return null;
                if (step.role === 'title')
                  return (
                    <h2 className="post-title" key={i}>
                      {step.text}
                    </h2>
                  );
                return (
                  <p key={i} className="description">
                    {step.runs
                      ? step.runs.map((run, r) => {
                          const content = run.bold ? (
                            <strong>{run.text}</strong>
                          ) : (
                            run.text
                          );
                          return run.href && safeLink(run.href) ? (
                            <a
                              href={safeLink(run.href)}
                              key={r}
                              onClick={(e) => e.preventDefault()}
                            >
                              {content}
                            </a>
                          ) : (
                            <span key={r}>{content}</span>
                          );
                        })
                      : step.text}
                  </p>
                );
              })}
            </div>
            {!!tags.length && (
              <div className="tag-box">
                <span>태그 칸</span>
                {tags.map((tag, i) => (
                  <span key={i}>{tag.replace(/^#/, '')}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <aside className="preview-differences">
        <strong>원문과 달라지는 점</strong>
        {plan.channel === 'band' ? (
          <>
            <p>
              제목은 글 첫 줄에 들어갑니다. 사진 {photos.length}장은 글 아래에
              모아서 올라갑니다.
            </p>
            <p>
              굵은 글씨는 일반 글자로, 표는 줄 글로 바뀝니다. 링크 주소는 글자로
              함께 들어가고 해시태그는 글 끝에 붙습니다.
            </p>
          </>
        ) : (
          <>
            <p>
              굵은 글씨와 링크는 원문대로 미리보기에 표시합니다. 실제 블로그
              입력의 서식 적용은 다음 작업에서 확인합니다.
            </p>
            <p>
              표를 만들지 못하면 줄 글로 바뀌고, 끝난 뒤 알려 드립니다.
              해시태그는 네이버 태그 칸에 들어갑니다.
            </p>
          </>
        )}
      </aside>
      {droppedStruckCharacters > 0 && (
        <p>취소선 글자 {droppedStruckCharacters}자는 옮기지 않습니다</p>
      )}
    </>
  );
}
