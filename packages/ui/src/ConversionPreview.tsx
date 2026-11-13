import type { InputPlan } from '@goltou/core';
export function ConversionPreview({ plan, expanded }: { plan: InputPlan; expanded: boolean }) {
  const visible = expanded ? plan.steps : plan.steps.slice(0, 8);
  return <div className="converted-content">{visible.map((step, i) => {
    if (step.kind === 'break') return null;
    if (step.kind === 'photos') return <div className="hero-photo" key={i}>사진 {step.urls.length}장 · 이 위치에 원본 첨부</div>;
    if (step.kind === 'table') return <table key={i}><tbody>{step.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table>;
    if (step.role === 'title') return <h2 key={i}>{step.text}</h2>;
    return <p key={i} className="description">{step.runs && plan.channel === 'blog' ? step.runs.map((run, r) => <span key={r}>{run.bold ? <strong>{run.text}</strong> : run.text}{run.href && <small className="muted"> ({run.href})</small>}</span>) : step.text}</p>;
  })}</div>;
}
