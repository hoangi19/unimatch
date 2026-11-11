// Demo-only state for the crawl and embedding cards. Delete with mock.ts and MockCards.tsx.
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { useToast } from '../ui/toast-context'
import { MOCK_HISTORY, MOCK_SOURCES, RUN_STEP_PCT, RUN_TICK_MS, type MockRun, type MockSource } from './mock'

/** Advances every running percent by one step per tick; finished ids are dropped and passed to `onDone`. */
export function useFakeProgress(onDone: (ids: string[]) => void) {
  const [runs, setRuns] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!Object.keys(runs).length) return
    const timer = setTimeout(() => {
      const next = Object.entries(runs).map(([id, pct]) => [id, Math.min(100, pct + RUN_STEP_PCT)] as const)
      setRuns(Object.fromEntries(next.filter(([, pct]) => pct < 100)))
      const done = next.filter(([, pct]) => pct >= 100).map(([id]) => id)
      if (done.length) onDone(done)
    }, RUN_TICK_MS)
    return () => clearTimeout(timer)
  }, [runs, onDone])
  return { runs, start: (id: string) => setRuns((r) => ({ ...r, [id]: 0 })) }
}

/** Crawl sources and run history share state: a finished run adds a history row. */
export function useMockCrawl() {
  const { t } = useI18n()
  const toast = useToast()
  const [sources, setSources] = useState<MockSource[]>(MOCK_SOURCES)
  const [history, setHistory] = useState<MockRun[]>(MOCK_HISTORY)
  const onDone = useCallback(
    (ids: string[]) => {
      const at = Date.now()
      setSources((list) => list.map((s) => (ids.includes(s.id) ? { ...s, lastRunAt: at } : s)))
      setHistory((h) => [...ids.map((id) => ({ at, source: id, status: 'success' as const, found: 120, added: 12, seconds: 6 })), ...h])
      ids.forEach((id) => {
        const name = MOCK_SOURCES.find((s) => s.id === id)?.name ?? id
        toast({ kind: 'success', title: t('dataset.run.done', { name }), body: t('dataset.run.doneBody', { n: 12 }) })
      })
    },
    [t, toast],
  )
  const progress = useFakeProgress(onDone)
  const toggle = (id: string, enabled: boolean) => setSources((list) => list.map((s) => (s.id === id ? { ...s, enabled } : s)))
  return { sources, history, runs: progress.runs, run: progress.start, toggle }
}
