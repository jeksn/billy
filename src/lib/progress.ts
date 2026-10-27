export interface ReadingProgress {
  cfi: string | null
  percent: number
  /** Unix ms of the last reading session. */
  at: number
}

const PREFIX = 'billy.progress.'

export function loadProgress(id: string): string | null {
  const raw = localStorage.getItem(PREFIX + id)
  if (raw === null) return null
  try {
    return (JSON.parse(raw) as { cfi?: string }).cfi ?? null
  } catch {
    return null
  }
}

export function saveProgress(
  id: string,
  cfi: string,
  percent: number,
  at: number,
) {
  localStorage.setItem(
    PREFIX + id,
    JSON.stringify({ cfi, percent: Math.round(percent), at }),
  )
}

export function loadAllProgress(): Map<string, ReadingProgress> {
  const map = new Map<string, ReadingProgress>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const id = key.slice(PREFIX.length)
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '') as {
        cfi?: string
        percent?: number
        at?: number
      }
      map.set(id, {
        cfi: raw.cfi ?? null,
        percent: typeof raw.percent === 'number' ? raw.percent : 0,
        at: typeof raw.at === 'number' ? raw.at : 0,
      })
    } catch {
      // Ignore malformed entries
    }
  }
  return map
}

/** A book counts as in-progress if it has been opened and is not finished. */
export function isInProgress(progress: ReadingProgress | undefined) {
  return (
    progress !== undefined &&
    progress.cfi !== null &&
    progress.percent < 100
  )
}

export type ReadingStatus = 'unread' | 'in-progress' | 'completed'

export function statusOf(progress: ReadingProgress | undefined): ReadingStatus {
  if (!progress || progress.cfi === null) return 'unread'
  return progress.percent >= 100 ? 'completed' : 'in-progress'
}

export function markCompleted(id: string) {
  const existing = loadProgressEntry(id)
  saveProgress(id, existing?.cfi ?? '', 100, Date.now())
}

/** Forget all reading state for a book, returning it to unread. */
export function clearProgress(id: string) {
  localStorage.removeItem(PREFIX + id)
}

function loadProgressEntry(id: string): ReadingProgress | undefined {
  const raw = localStorage.getItem(PREFIX + id)
  if (raw === null) return undefined
  try {
    const entry = JSON.parse(raw) as {
      cfi?: string
      percent?: number
      at?: number
    }
    return {
      cfi: entry.cfi ?? null,
      percent: typeof entry.percent === 'number' ? entry.percent : 0,
      at: typeof entry.at === 'number' ? entry.at : 0,
    }
  } catch {
    return undefined
  }
}
