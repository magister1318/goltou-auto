/** Exact editor text and attributes. Only adjacent, identically formatted runs merge. */
export interface BlogRun { text: string; bold?: boolean; href?: string | null }
export interface NormalizedBlogRun { text: string; bold: boolean; href: string | null }
export function normalizeBlogRuns(runs: readonly BlogRun[]): NormalizedBlogRun[] {
  const result: NormalizedBlogRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const value = { text: run.text, bold: run.bold === true, href: run.href ?? null };
    const last = result[result.length - 1];
    if (last && last.bold === value.bold && last.href === value.href) last.text += value.text;
    else result.push(value);
  }
  return result;
}
export function splitBlogRuns(runs: readonly BlogRun[]): NormalizedBlogRun[][] {
  const paragraphs: BlogRun[][] = [[]];
  for (const run of runs) for (const [index, text] of run.text.split('\n').entries()) {
    if (index) paragraphs.push([]);
    paragraphs[paragraphs.length - 1]!.push({ ...run, text });
  }
  return paragraphs.map(normalizeBlogRuns);
}
export type FormattingStage = 'INPUT' | 'BEFORE_SAVE' | 'AFTER_SAVE' | 'REOPENED' | 'PUBLISHED';
export interface BlogFormattingIssue { paragraph: number; fields: ('text' | 'bold' | 'href' | 'input')[] }
/** Contains positions only, never editor content, addresses or account data. */
export class BlogFormattingError extends Error {
  constructor(readonly stage: FormattingStage, readonly issues: BlogFormattingIssue[]) {
    super(`BLOG_FORMATTING_${stage}:${[...new Set(issues.map(i => i.paragraph))].join(',')}`);
  }
}

// Used verbatim by both the document and cursor readers. Read-only: no DOM or Selection writes.
export const blogRunReader = `
  const paragraphRuns=p=>{
    const out=[];
    const walk=n=>{
      if(n.nodeType===3){
        const text=n.nodeValue||'';if(!text)return;
        let bold=false,href=null;
        for(let e=n.parentElement;e;e=e.parentElement){
          if(e.classList.contains('se-placeholder'))return;
          const weight=e.ownerDocument.defaultView.getComputedStyle(e).fontWeight;
          if(e.tagName==='STRONG'||e.tagName==='B'||weight==='bold'||Number(weight)>=600)bold=true;
          if(href===null&&e.tagName==='A'&&e.hasAttribute('href'))href=e.getAttribute('href');
          if(e===p)break;
        }
        const last=out[out.length-1];
        if(last&&last.bold===bold&&last.href===href)last.text+=text;else out.push({text,bold,href});
      }else for(const c of n.childNodes)walk(c);
    };if(p)walk(p);return out;
  };`;
