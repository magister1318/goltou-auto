/** Content-free engine events. Indexes refer to the app's existing input plan. */
export interface EngineActivity {
  channel: 'blog' | 'band';
  stage: 'open' | 'write' | 'verify' | 'submit';
  phase: 'start' | 'progress' | 'finish';
  blockIndex?: number;
  blockTotal?: number;
  blockKind?: 'title' | 'paragraph' | 'table' | 'tags' | 'photos';
  fraction?: number;
  photoIndex?: number;
  photoTotal?: number;
  verification?: 'title' | 'body' | 'photos' | 'facts' | 'tags';
  submission?: 'draft' | 'publish';
}
