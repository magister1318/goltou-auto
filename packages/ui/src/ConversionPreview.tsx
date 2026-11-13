import type { InputPlan } from '@goltou/core';
import { ProductPhoto } from './ProductPhoto';
export function ConversionPreview({ plan, expanded, droppedStruckCharacters }: { plan: InputPlan; expanded: boolean; droppedStruckCharacters: number }) {
  const visible = expanded ? plan.steps : plan.steps.slice(0, 8);
  const totalPhotos = plan.steps.reduce((count, step) => count + (step.kind === 'photos' ? step.urls.length : 0), 0);
  let photoIndex = 0;
  return <><div className="converted-content">{visible.map((step, i) => {
    if (step.kind === 'break') return null;
    if (step.kind === 'photos') return <div className="preview-photos" key={i}>{step.urls.map((url, n) => <figure key={`${n}:${url}`}><ProductPhoto url={url} preview/><figcaption>사진 {++photoIndex}/{totalPhotos}</figcaption></figure>)}</div>;
    if (step.kind === 'table') return <table key={i}><tbody>{step.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table>;
    if (step.role === 'title') return <h2 key={i}>{step.text}</h2>;
    return <p key={i} className="description">{step.runs && plan.channel === 'blog' ? step.runs.map((run, r) => <span key={r}>{run.bold ? <strong>{run.text}</strong> : run.text}{run.href && <small className="muted"> ({run.href})</small>}</span>) : step.text}</p>;
  })}</div>{droppedStruckCharacters > 0 && <p>취소선 글자 {droppedStruckCharacters}자는 옮기지 않습니다</p>}</>;
}
