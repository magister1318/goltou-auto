import { clickHitTags, type ClickTargetOptions } from '../index';

export function clickTargetExpression(x: number, y: number, selector: string, options?: ClickTargetOptions) {
  const allowed = options?.onMiss ? {
    tags: clickHitTags, classes: options.onMiss.classes, classPrefixes: options.onMiss.classPrefixes,
    ancestorClasses: options.onMiss.ancestorClasses, labels: options.onMiss.ariaLabels,
  } : null;
  const args = [x, y, selector, options?.exactText ?? null, options?.direct ?? false, allowed].map(value => JSON.stringify(value)).join(',');
  return String.raw`((x, y, selector, exactText, direct, allowed) => {
    let d = document, offsetX = 0, offsetY = 0, frameDepth = 0;
    let hit = d.elementFromPoint(x, y);
    const fromShadow = () => {
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x - offsetX, y - offsetY);
        if (!inner || inner.getRootNode() !== hit.shadowRoot) break;
        hit = inner;
      }
    };
    fromShadow();
    let frameBlocked = false, inaccessibleFrame = false;
    while (hit?.localName === 'iframe' || hit?.localName === 'frame') {
      const child = hit.contentDocument;
      const style = getComputedStyle(hit);
      const r = hit.getBoundingClientRect();
      // Frame origins can be translated with box geometry. Reject ambiguous mappings.
      for (let e = hit; e; e = e.parentElement || e.getRootNode().host) {
        const s = getComputedStyle(e);
        const matrix = s.transform === 'none' ? null : new DOMMatrixReadOnly(s.transform);
        if ((matrix && (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1)) ||
            (s.scale && s.scale !== 'none' && s.scale !== '1') ||
            (s.rotate && s.rotate !== 'none' && s.rotate !== '0deg') ||
            (s.perspective && s.perspective !== 'none') ||
            (s.zoom && s.zoom !== 'normal' && s.zoom !== '1')) {
          frameBlocked = true;
          break;
        }
      }
      if (!child || frameBlocked) {
        inaccessibleFrame = !child;
        frameBlocked = true;
        break;
      }
      offsetX += r.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      offsetY += r.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      d = child;
      frameDepth++;
      hit = d.elementFromPoint(x - offsetX, y - offsetY);
      fromShadow();
    }
    const targets = hit && !frameBlocked ? Array.from(d.querySelectorAll(selector)) : [];
    for (let e = hit; e; e = e.parentElement) {
      if (targets.includes(e) && (exactText === null || (e.textContent || '').trim() === exactText)) return true;
      if (direct) break;
    }
    if (!allowed) return false;
    const miss = { scrollX, scrollY, inShadow: !!hit?.getRootNode().host, frameDepth };
    if (!hit) return miss;
    const rect = e => {
      const r = e.getBoundingClientRect();
      return { x: offsetX + r.left, y: offsetY + r.top, width: r.width, height: r.height };
    };
    let relation = 'unrelated';
    for (const target of targets) {
      const r = rect(target);
      if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) continue;
      if (target === hit) { relation = 'same'; break; }
      if (target.contains(hit)) { relation = 'descendant'; break; }
      if (hit.contains(target)) { relation = 'ancestor'; break; }
    }
    const tag = hit.localName;
    const classes = (hit.getAttribute('class') || '').split(/\s+/);
    const ancestors = new Set();
    if (allowed.ancestorClasses?.length) {
      for (let e = hit.parentElement || hit.getRootNode().host; e; e = e.parentElement || e.getRootNode().host) {
        for (const name of allowed.ancestorClasses) if (e.classList.contains(name)) ancestors.add(name);
      }
    }
    const label = hit.getAttribute('aria-label');
    return { ...miss, ...(inaccessibleFrame ? { inaccessibleFrame: true } : {}), rejectedHit: {
      tag: allowed.tags.includes(tag) ? tag : '[other]',
      classes: [...allowed.classes.filter(name => classes.includes(name)),
        ...(allowed.classPrefixes || []).filter(prefix => classes.some(name => name.startsWith(prefix + '__')))],
      ...(ancestors.size ? { ancestorClasses: Array.from(ancestors) } : {}),
      ariaLabel: label ? (allowed.labels.includes(label) ? label : '[other]') : null,
      rect: rect(hit), relation,
    } };
  })(${args})`;
}
