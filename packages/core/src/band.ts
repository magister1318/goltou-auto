import { BandExecution, type BandDirectory, type BandReadback } from '@goltou/sites';
import type { SurfaceHost } from '@goltou/surface';
import type { InputPlan } from './convert';
import type { MediaFile } from './media';
import { compact, compareDocuments, observePlan, type Observation } from './verify';

export interface BandServices { host: SurfaceHost; baseUrl?: string; localPublish?: boolean }
/** Readback supplies all characters and photo identities; plan boundaries only assign semantic roles. */
export function bandObservation(plan: InputPlan, files: readonly Pick<MediaFile, 'url' | 'path'>[], actual: BandReadback): Observation {
  const result: Observation = { title: '', text: actual.body, paragraphs: [], photos: [], prices: [], departures: [], golfCourses: [] };
  const body = compact(actual.body);
  let offset = 0;
  for (const step of plan.steps) {
    if (step.kind === 'break' || step.kind === 'photos') continue;
    const lines = step.kind === 'table' ? step.rows.map(r => r.join(' | ')) : [step.text];
    for (const line of lines) {
      const value = body.slice(offset, offset + compact(line).length); offset += compact(line).length;
      if (step.role === 'title') result.title = value;
      if (step.role === 'body') result.paragraphs.push(value);
      if (step.role === 'courses') result.golfCourses.push(value);
      if (step.role === 'departures') {
        result.departures.push(value.match(/^([^|]+)\|/)?.[1] ?? '');
        result.prices.push(value.match(/\|(.*)원$/)?.[1] ?? '');
      }
    }
  }
  const expected = plan.steps.flatMap(s => s.kind === 'photos' ? s.urls : []);
  result.photos = actual.photos.map((identity, index) => {
    const url = expected[index]; const file = files.find(f => f.url === url);
    return identity && identity === file?.path.split(/[\\/]/).pop() ? url! : 'UNVERIFIED_PHOTO';
  });
  return result;
}
export function createBandExecution(plan: InputPlan, files: readonly Pick<MediaFile, 'url' | 'path'>[], directory: BandDirectory, key: string,
  hooks: Pick<ConstructorParameters<typeof BandExecution>[2], 'check' | 'progress'>) {
  const execution: BandExecution = new BandExecution(plan, files, { ...hooks, directory, key, verify: actual => {
    const result = compareDocuments(observePlan(plan), bandObservation(plan, execution.files, actual));
    if (!result.matches) throw new Error(`BAND_READBACK_MISMATCH:${result.differences.map(d => d.field).join(',')}`);
  } });
  return execution;
}
