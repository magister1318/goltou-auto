import type { Channel, Product, ProductSummary } from '@goltou/api-client';
import type { ProductTag } from '@goltou/core';
import { ProductPhoto } from './ProductPhoto';

export const channelLabel = (channel: Channel) => channel === 'blog' ? '블로그' : '밴드';
const koreaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
const koreaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const koreaTimestamp = (value: string) => Date.parse(
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value.replace(' ', 'T')}+09:00` : value,
);
export const monthDay = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5).replace('-', '.');
  const at = koreaTimestamp(value);
  if (!Number.isFinite(at)) return '';
  const parts = koreaDate.formatToParts(at);
  return `${parts.find(part => part.type === 'month')?.value}.${parts.find(part => part.type === 'day')?.value}`;
};
export const hourMinute = (value: string) => {
  const at = koreaTimestamp(value);
  return Number.isFinite(at) ? koreaTime.format(at) : '—';
};

export function ProductMeta({ country, region, ownerNickname }: Pick<Product, 'country' | 'region' | 'ownerNickname'>) {
  const place = [country, region].filter(Boolean).join(' ');
  return <>{place}{ownerNickname !== undefined && <>{place && ' · '}등록 <b>{ownerNickname ?? '담당자 없음'}</b></>}</>;
}

export function ProductListItem({ product, detail, publish }: { product: ProductSummary; detail(): void; publish(): void }) {
  return (
    <article className="product-item">
      <button className="product-row" onClick={detail}>
        <span className="product-copy">
          <strong>{product.title}</strong>
          <small><ProductMeta {...product} /></small>
        </span>
        <ProductPhoto url={product.thumbUrl} retry={false} />
      </button>
      <div className="product-status-row">
        <div className="product-statuses" aria-label="내가 올린 기록">
          {(['blog', 'band'] as const).map(channel => {
            const mark = product.myPosts[channel];
            const status = mark?.status === 'published' ? 'posted' : mark?.status === 'draft_saved' ? 'draft' : 'none';
            return <div className={`product-status ${status}`} key={channel}>
              <i aria-hidden="true" />
              <b>{channelLabel(channel)}</b>
              <span>{status === 'none' ? '안 올림' : [monthDay(mark!.at), status === 'draft' ? '임시저장' : channel === 'blog' ? '발행' : '게시'].filter(Boolean).join(' ')}
                {product.changed?.[channel] && <span className="warn"> · 올린 뒤 상품이 바뀜</span>}
              </span>
            </div>;
          })}
        </div>
        <button className="product-publish" onClick={publish}>올리기</button>
      </div>
    </article>
  );
}

export function PreviousPublication({ product }: { product: ProductSummary | undefined }) {
  const entries = (['blog', 'band'] as const).flatMap(channel => {
    const mark = product?.myPosts[channel];
    return mark?.status === 'published' ? [{ channel, day: monthDay(mark.at) }] : [];
  });
  if (!entries.length) return null;
  const when = entries.every(entry => entry.day === entries[0]!.day)
    ? `${entries[0]!.day ? `${entries[0]!.day}에 ` : ''}${entries.map(entry => channelLabel(entry.channel)).join('·')}에`
    : entries.map(({ day, channel }) => `${day ? `${day}에 ` : ''}${channelLabel(channel)}에`).join(', ');
  return <div className="previous-publication">이 상품은 {when} 올린 적이 있습니다. 다시 발행하면 새 글로 하나 더 올라갑니다.</div>;
}

export function ProductPostHistory({ posts, open }: { posts: Product['posts']; open(url: string): void }) {
  if (!posts) return null;
  return (
    <section className="product-posts">
      <h2>이 상품을 올린 사람 <span>{posts.length}건</span></h2>
      {!posts.length && <p>아직 아무도 올리지 않았습니다</p>}
      {posts.map(post => <div className="product-post" key={post.postNo}>
        <span className={`post-channel ${post.channel}`}>{channelLabel(post.channel)}</span>
        <div className="product-post-copy">
          <b>{post.nickname}</b> · {monthDay(post.at)} {post.status === 'published' ? '발행' : '임시저장'}
          {post.targetName && <small>{post.targetName}</small>}
          {post.changed && <small className="warn">올린 뒤 상품이 바뀜</small>}
        </div>
        {post.postUrl && <button className="green post-link" onClick={() => open(post.postUrl)}>글 보기</button>}
      </div>)}
    </section>
  );
}

const tagKinds = { country: '국가', region: '지역', course: '골프장', word: '정해 둔 글자' };
export function PostingTags({ tags }: { tags: ProductTag[] }) {
  return <section className="posting-tags">
    <h2 className="section-label">들어갈 태그 {tags.length}개</h2>
    <ul>{tags.map(tag => <li key={tag.text}>#{tag.text}<small>{tagKinds[tag.kind]}</small></li>)}</ul>
  </section>;
}
