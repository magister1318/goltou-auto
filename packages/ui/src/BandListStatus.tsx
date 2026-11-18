export function bandListTime(savedAt: number, now = new Date()) {
  const date = new Date(savedAt);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(day); yesterday.setDate(day.getDate() - 1);
  const label = date >= day ? '오늘' : date >= yesterday ? '어제' : `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return `마지막 확인: ${label} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function BandListStatus({ savedAt, loading, refresh }: { savedAt: number | null; loading: boolean; refresh(): void }) {
  return <>
    <div className="band-list-heading"><small>밴드 목록</small><button className="green" disabled={loading} onClick={refresh}>새로고침</button></div>
    {savedAt !== null && <small className="band-list-time">{bandListTime(savedAt)}</small>}
    {loading && <p role="status">밴드 목록을 읽는 중입니다</p>}
  </>;
}
