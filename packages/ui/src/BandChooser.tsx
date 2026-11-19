import { useState } from 'react';
import type { BandChoice } from '@goltou/sites';
import type { ProductPost } from '@goltou/api-client';
import { koreaTimestamp, monthDay } from './ProductPosting';
export function BandChooser({
  bands,
  value,
  choose,
  back,
  posts,
  now = Date.now(),
}: {
  bands: BandChoice[];
  value: string | string[];
  choose(key: string): void;
  back?(): void;
  posts?: ProductPost[] | undefined;
  now?: number;
}) {
  const multiple = Array.isArray(value);
  const [query, setQuery] = useState('');
  const filtered = bands.filter((b) =>
    b.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      {back && <button
        className="back sheet-back"
        aria-label="발행 창으로 돌아가기"
        onClick={back}
      >
        ← 발행 창으로
      </button>}
      {bands.length >= 9 && (
        <input
          aria-label="밴드 이름으로 찾기"
          placeholder="밴드 이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div role={multiple ? 'group' : 'radiogroup'} aria-label="올릴 밴드">
        {filtered.map(b => {
          const selected = multiple ? value.includes(b.key) : value === b.key;
          const recent = selected && posts?.reduce((latest, post) => {
            if (post.channel !== 'band' || post.targetKey !== b.key || post.status !== 'published') return latest;
            const at = koreaTimestamp(post.at);
            return at <= now && now - at <= 3 * 86400000 ? Math.max(latest, at) : latest;
          }, -Infinity);
          return <div className="band-choice" key={b.key}>
            <button className={`band-row${multiple ? ' pick' : ''}${selected ? ' on' : ''}`}
              role={multiple ? 'checkbox' : 'radio'} aria-checked={selected} onClick={() => choose(b.key)}>
              <span className={multiple ? 'check-box' : 'radio-mark'} aria-hidden="true">{multiple && selected ? '✓' : ''}</span>
              <span className="band-name">{b.name}</span>
            </button>
            {typeof recent === 'number' && Number.isFinite(recent) && <p className="band-recent warn">
              3일 안에 이 밴드에 올린 적이 있습니다 ({monthDay(new Date(recent).toISOString())})
            </p>}
          </div>;
        })}
      </div>
      {bands.length > 0 && !filtered.length && (
        <p className="list-state">이름에 맞는 밴드가 없습니다.</p>
      )}
    </>
  );
}
