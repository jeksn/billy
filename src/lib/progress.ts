import { invoke } from '@tauri-apps/api/core'

export interface ReadingProgress {
  cfi: string | null
  percent: number
  /** Unix ms of the last reading session. */
  at: number
}

interface ProgressEntry {
  bookId: string
  cfi: string | null
  percent: number
  at: number
}

export async function loadAllProgress(): Promise<Map<string, ReadingProgress>> {
  const entries = await invoke<ProgressEntry[]>('get_progress')
  return new Map(
    entries.map((entry) => [
      entry.bookId,
      { cfi: entry.cfi, percent: entry.percent, at: entry.at },
    ]),
  )
}

export async function saveProgress(
  id: string,
  cfi: string | null,
  percent: number,
  at: number,
) {
  await invoke('save_progress', {
    bookId: id,
    cfi,
    percent: Math.round(percent),
    at,
  })
}

export async function clearProgress(id: string) {
  await invoke('clear_progress', { bookId: id })
}

export type ReadingStatus = 'unread' | 'in-progress' | 'completed'

export function statusOf(progress: ReadingProgress | undefined): ReadingStatus {
  if (!progress || progress.percent <= 0) return 'unread'
  return progress.percent >= 100 ? 'completed' : 'in-progress'
}

export function isInProgress(progress: ReadingProgress | undefined) {
  return statusOf(progress) === 'in-progress'
}

const LEGACY_PREFIX = 'billy.progress.'

/**
 * One-time migration from the old localStorage-backed progress format to the
 * library database. Removes the legacy entries as it goes.
 */
export async function migrateLegacyProgress(): Promise<void> {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(LEGACY_PREFIX)) keys.push(key)
  }
  for (const key of keys) {
    const id = key.slice(LEGACY_PREFIX.length)
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '') as {
        cfi?: string
        percent?: number
        at?: number
      }
      await saveProgress(
        id,
        raw.cfi ?? null,
        raw.percent ?? 0,
        raw.at ?? 0,
      )
    } catch {
      // Skip malformed entries but still remove them below.
    }
    localStorage.removeItem(key)
  }
}
