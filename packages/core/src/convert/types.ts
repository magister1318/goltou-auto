export interface Run { text: string; bold?: boolean; href?: string }
export type Block =
  | { kind: 'paragraph'; id: string; runs: Run[] }
  | { kind: 'image'; url: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'link'; text: string; href: string };
export interface Discard { reason: string; tag: string; offset: number | null }
export interface ParsedContent { blocks: Block[]; discarded: Discard[] }
export type Role = 'title' | 'body' | 'departures' | 'courses' | 'closing' | 'linkCard' | 'hashtags';
export type InputStep =
  | { kind: 'text'; role: Role; text: string; runs?: Run[]; paragraphId?: string }
  | { kind: 'break' }
  | { kind: 'photos'; urls: string[] }
  | { kind: 'table'; role: Role; rows: string[][] };
export interface InputPlan { channel: 'blog' | 'band'; steps: InputStep[]; discarded: Discard[] }
export interface ConvertOptions { closing?: boolean; closingText?: string; linkCard?: boolean; hashtags?: string[] }
export const runText = (runs: readonly Run[]) => runs.map(run => run.text).join('');
export const blockText = (block: Block) => block.kind === 'paragraph' ? runText(block.runs) : block.kind === 'link' ? block.text : block.kind === 'table' ? block.rows.map(row => row.join(' ')).join('\n') : '';
