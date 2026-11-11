// Demo-only data for the parts of the Dataset tab that have no backend yet: crawl sources, chunking
// settings, run history and per-job embedding status. Local state only, nothing is sent or saved.
// Delete this module (with MockCards.tsx and useMock.ts) once the real crawl and embedding land.
import type { MessageKey } from '../i18n'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// Fixed at module load, so the fake times reset on reload.
const NOW = Date.now()

export type MockSource = {
  id: string
  name: string
  kind: 'linkedin' | 'facebook_group'
  keywords: string[]
  location: string
  cron: string
  enabled: boolean
  lastRunAt: number
  lastFound: number
}

export const MOCK_SOURCES: MockSource[] = [
  { id: 's1', name: 'Part-time · Hanoi', kind: 'linkedin', keywords: ['Part-time', 'Sinh viên', 'Thực tập'], location: 'Hanoi', cron: '0 */6 * * *', enabled: true, lastRunAt: NOW - 18 * MIN, lastFound: 23 },
  { id: 's2', name: 'Việc làm thêm Hà Nội', kind: 'facebook_group', keywords: ['Tuyển gấp', 'Ca tối'], location: 'Hanoi', cron: '0 */12 * * *', enabled: true, lastRunAt: NOW - 5 * HOUR, lastFound: 17 },
  { id: 's3', name: 'Internships · Nationwide', kind: 'linkedin', keywords: ['Intern', 'Fresher'], location: 'Vietnam', cron: '0 2 * * *', enabled: false, lastRunAt: NOW - 3 * DAY, lastFound: 31 },
]

export type MockRun = { at: number; source: string; status: 'success' | 'failed' | 'partial'; found: number; added: number; seconds: number; error?: MessageKey }

export const MOCK_HISTORY: MockRun[] = [
  { at: NOW - 18 * MIN, source: 's1', status: 'success', found: 184, added: 23, seconds: 212 },
  { at: NOW - 5 * HOUR, source: 's2', status: 'success', found: 141, added: 17, seconds: 176 },
  { at: NOW - (6 * HOUR + 18 * MIN), source: 's1', status: 'failed', found: 0, added: 0, seconds: 41, error: 'dataset.hist.e429' },
  { at: NOW - 12 * HOUR, source: 's2', status: 'partial', found: 96, added: 11, seconds: 305, error: 'dataset.hist.ePartial' },
  { at: NOW - 3 * DAY, source: 's3', status: 'success', found: 74, added: 31, seconds: 98 },
]

export type ChunkSettings = { chunkSize: number; overlap: number; retention: number }
export const MOCK_CHUNKING: ChunkSettings = { chunkSize: 512, overlap: 64, retention: 30 }

export type EmbedStatus = 'embedded' | 'pending' | 'failed'

/** A stable fake embedding status per job, so the same job always shows the same badge. */
export function mockEmbedStatus(externalId: string): EmbedStatus {
  let h = 0
  for (const ch of externalId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const n = h % 10
  return n < 7 ? 'embedded' : n < 9 ? 'pending' : 'failed'
}

/** Fake crawl run: queued, then Fetch → Parse → Embed. Percent bounds for each phase. */
export const RUN_STEPS = ['dataset.run.fetch', 'dataset.run.parse', 'dataset.run.embed'] as const satisfies readonly MessageKey[]
const PHASE_START = [6, 58, 74]

/** -1 while queued, then the index of the active step in RUN_STEPS. */
export function runStep(pct: number): number {
  return PHASE_START.findLastIndex((start) => pct >= start)
}

/** Percent added per tick (one tick per RUN_TICK_MS); a run takes about 6 s. */
export const RUN_TICK_MS = 150
export const RUN_STEP_PCT = 2.5
