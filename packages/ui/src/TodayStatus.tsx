import { useEffect, useState } from 'react';
import type { TodayStats } from '@goltou/api-client';
import { hourMinute, monthDay } from './ProductPosting';
import { request } from './store';

export function TodayStatus({ refresh }: { refresh: number }) {
  const [value, setValue] = useState<TodayStats | 'loading' | 'error' | null>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setValue('loading');
    void request('stats.today', {}, true).then(value => {
      if (live) setValue(value === null || typeof value?.date === 'string' && Array.isArray(value.rows) ? value : 'error');
    }).catch(() => {
      if (live) setValue('error');
    });
    return () => { live = false; };
  }, [refresh, retry]);
  if (!value) return null;
  const date = typeof value === 'object' ? value.date : new Date().toISOString();
  return <section className="today-status">
    <h2>오늘 현황 ({monthDay(date)})</h2>
    {value === 'loading' ? <p role="status">오늘 현황을 불러오는 중입니다.</p>
      : value === 'error' ? <div className="today-error"><p role="alert">오늘 현황을 불러오지 못했습니다.</p><button className="green" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></div>
        : !value.rows.length ? <p>오늘 등록 기록이 없습니다.</p>
          : <table aria-label="오늘 현황">
            <thead><tr><th scope="col">닉네임</th><th scope="col">발행</th><th scope="col">임시저장</th><th scope="col">실패</th><th scope="col">멈춤</th><th scope="col">마지막 시각</th></tr></thead>
            <tbody>{value.rows.map(row => <tr key={row.userNo}>
              <th scope="row">{row.nickname}</th><td>{row.published}</td><td>{row.drafts}</td>
              <td className={row.failed ? 'danger' : ''}>{row.failed}</td><td>{row.stopped}</td><td>{hourMinute(row.lastAt)}</td>
            </tr>)}</tbody>
          </table>}
  </section>;
}
