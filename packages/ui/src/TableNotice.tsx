export function TableNotice({ fallback }: { fallback?: boolean | undefined }) {
  return fallback ? <p className="meta table-notice" role="note">표를 넣지 못해 같은 내용을 글자 행으로 옮겼습니다.</p> : null;
}
