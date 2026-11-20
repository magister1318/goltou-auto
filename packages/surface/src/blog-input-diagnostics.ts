const locations = ['marker_insert', 'marker_readback', 'paragraph_end', 'open_dialog', 'link_control',
  'link_address_wait', 'link_address_target', 'link_confirm', 'link_dialog_close'] as const;
const phases = ['insert', 'after_undo'] as const;
const characterKinds = ['digit', 'period', 'space', 'hangul', 'latin', 'emoji', 'other'] as const;

export interface BlogInputDiagnostic {
  location: typeof locations[number];
  phase?: typeof phases[number] | undefined;
  markerLength: number;
  observedCharacters?: number | undefined;
  startsWithMarker?: boolean | undefined;
  firstCharacters?: readonly (typeof characterKinds[number])[] | undefined;
  emojiCount?: number | undefined;
  inList?: boolean | undefined;
}

const count = (value: number | undefined) => value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function sanitizeBlogInput(value: BlogInputDiagnostic): BlogInputDiagnostic | undefined {
  const markerLength = count(value.markerLength);
  if (!locations.includes(value.location) || markerLength === undefined) return;
  return {
    location: value.location,
    phase: value.phase && phases.includes(value.phase) ? value.phase : undefined,
    markerLength,
    observedCharacters: count(value.observedCharacters),
    startsWithMarker: typeof value.startsWithMarker === 'boolean' ? value.startsWithMarker : undefined,
    firstCharacters: Array.isArray(value.firstCharacters)
      ? value.firstCharacters.slice(0, 3).map(kind => characterKinds.includes(kind) ? kind : 'other') : undefined,
    emojiCount: count(value.emojiCount),
    inList: typeof value.inList === 'boolean' ? value.inList : undefined,
  };
}
