import type { InputPlan } from '@goltou/core';
import { bandText, expectedBlogTags, photoUrls } from '@goltou/sites';
import { ProductPhoto } from './ProductPhoto';
import { UnbrokenPhone } from './MyTextSettings';
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
/** Tokens preserve every character; styling never rewrites the posting plan. */
export function BandText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>]+|#[\p{L}\p{N}_]+)/gu).map((part, i) => /^https?:\/\//.test(part) && safeLink(part)
    ? <a key={i} href={safeLink(part)} onClick={e => e.preventDefault()}>{part}</a>
    : <span key={i} className={/^#[\p{L}\p{N}_]+$/u.test(part) ? 'band-hashtag' : undefined}>{part}</span>)}</>;
}
function PreviewPhrase({ role, text, phone }: { role: 'prefix' | 'closing'; text: string; phone?: string | undefined }) {
  return <span className={`preview-phrase ${role}`}>
    <small>{role === 'prefix' ? '글 앞 문구' : '글 끝 문구'}</small>
    <UnbrokenPhone text={text} phone={phone} />
  </span>;
}

function FullBandText({ plan, phone }: { plan: InputPlan; phone?: string | undefined }) {
  const steps = plan.steps.filter(step => step.kind === 'text' || step.kind === 'table');
  return <>{steps.map((step, index) => {
    const text = bandText({ ...plan, steps: [step] });
    return <span key={index}>{index > 0 && '\n\n'}{step.role === 'prefix' || step.role === 'closing'
      ? <PreviewPhrase role={step.role} text={text} phone={phone} />
      : step.role === 'hashtags' ? <span className="band-tag-line"><BandText text={text} /></span>
        : <BandText text={text} />}</span>;
  })}</>;
}
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
  phone,
}: {
  plan: InputPlan;
  expanded: boolean;
  droppedStruckCharacters: number;
  ratios?: Record<string, number>;
  bandName?: string | undefined;
  phone?: string | undefined;
}) {
  const visible = expanded ? plan.steps : plan.steps.slice(0, 8);
  const photos = photoUrls(plan);
  const tags = plan.channel === 'blog' ? expectedBlogTags(plan) : [];
  return (
    <>
      <div className={`converted-content service-post ${plan.channel}`}>
        <div className="post-caption">
          <span>{plan.channel === 'blog' ? '블로그 글' : '밴드 글'}</span>
          {plan.channel === 'band' && <span>{bandName || '밴드를 고르면 이름이 나옵니다'}</span>}
        </div>
        {plan.channel === 'band' ? (
          <>
            <section className="band-feed-sample" aria-label="목록 모양"><h3>목록에서는 이렇게 보입니다</h3><div className="band-text"><BandText text={Array.from(bandText(plan)).slice(0, 115).join('')} />{Array.from(bandText(plan)).length > 115 && <span className="band-more">… 더보기</span>}</div><div className="band-feed-collage">{photos.slice(0, 3).map((url, i) => <span className="band-feed-tile" key={i}><ProductPhoto url={url} preview ratio={1} />{i === 2 && photos.length > 3 && <span className="band-remaining">+{photos.length - 3}</span>}</span>)}</div></section>
            <div className="band-text band-full-text"><FullBandText plan={plan} phone={phone} /></div>
            <div className="band-photo-stack">
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
                        <tbody>
                          {step.rows.map((row, r) => (
                            <tr key={r}>
                              {row.map((cell, c) => (
                                <td key={c}>{(step.cellRuns?.[r]?.[c] ?? [{text:cell}]).map((run,n)=>{
                                  const content=run.bold ? <strong>{run.text}</strong> : run.text;
                                  return run.href && safeLink(run.href) ? <a key={n} href={safeLink(run.href)} onClick={e=>e.preventDefault()}>{content}</a> : <span key={n}>{content}</span>;
                                })}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                if (step.role === 'hashtags') return null;
                if (step.role === 'prefix' || step.role === 'closing')
                  return <PreviewPhrase key={i} role={step.role} text={step.text} phone={phone} />;
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
              굵은 글씨, 링크와 표를 원문 순서대로 옮깁니다.
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
