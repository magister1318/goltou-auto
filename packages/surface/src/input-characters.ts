// Reference: ../refs/DAF/daf3/apps/mobile/src/core/intl.ts (extendsCluster and grapheme input grouping only).
// nodejs-mobile has no ICU/Intl. Keep common combining marks, emoji selectors,
// joined emoji, modifiers, flag pairs and Hangul jamo in one input event.
function extendsCluster(cp: number): boolean {
  return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff)
    || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff)
    || (cp >= 0xfe20 && cp <= 0xfe2f) || (cp >= 0xfe00 && cp <= 0xfe0f)
    || (cp >= 0xe0100 && cp <= 0xe01ef) || (cp >= 0x1f3fb && cp <= 0x1f3ff)
    || (cp >= 0xe0020 && cp <= 0xe007f) || cp === 0x200d
    || (cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0xd7b0 && cp <= 0xd7ff);
}
const regional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
export function inputCharacters(text: string): string[] {
  const points = Array.from(text), units: string[] = [];
  for (let i = 0; i < points.length;) {
    let unit = points[i++]!, previous = unit.codePointAt(0)!;
    if (regional(previous) && i < points.length && regional(points[i]!.codePointAt(0)!)) unit += points[i++]!;
    while (i < points.length) {
      const next = points[i]!.codePointAt(0)!;
      if (previous !== 0x200d && !extendsCluster(next)) break;
      unit += points[i++]!; previous = next;
    }
    units.push(unit);
  }
  return units;
}
