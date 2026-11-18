import { useState } from 'react';
import type { BandChoice } from '@goltou/sites';
export function BandChooser({
  bands,
  value,
  choose,
  back,
}: {
  bands: BandChoice[];
  value: string | string[];
  choose(key: string): void;
  back(): void;
}) {
  const multiple = Array.isArray(value);
  const [query, setQuery] = useState('');
  const filtered = bands.filter((b) =>
    b.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <button
        className="back sheet-back"
        aria-label="발행 창으로 돌아가기"
        onClick={back}
      >
        ← 발행 창으로
      </button>
      <p>글을 쓸 수 있는 밴드 {bands.length}개입니다.</p>
      {bands.length >= 9 && (
        <input
          aria-label="밴드 이름으로 찾기"
          placeholder="밴드 이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div role={multiple ? 'group' : 'radiogroup'} aria-label="올릴 밴드">
        {filtered.map((b) => (
          <button
            className="band-row"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={Array.isArray(value) ? value.includes(b.key) : value === b.key}
            key={b.key}
            onClick={() => choose(b.key)}
          >
            <span className="radio-mark" />
            <span className="band-name">{b.name}</span>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <p className="list-state">이름에 맞는 밴드가 없습니다.</p>
      )}
    </>
  );
}
