import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export interface Book {
  id: string
  title: string
  author: string | null
  format: string
  cover: string | null
  path: string
  year: number | null
  fileSize: number
  importedAt: string
}

export interface AppStateSummary {
  libraryPath: string | null
  bookCount: number
}

export type ImportEvent =
  | { event: 'Progress'; data: { current: number; total: number; file: string } }
  | { event: 'Imported'; data: { book: Book } }
  | { event: 'Skipped'; data: { file: string; reason: string } }
  | { event: 'Failed'; data: { file: string; error: string } }
  | { event: 'Done'; data: { imported: number; skipped: number; failed: number } }

export async function getAppState(): Promise<AppStateSummary> {
  return invoke<AppStateSummary>('get_app_state')
}

export async function setLibrary(path: string): Promise<AppStateSummary> {
  return invoke<AppStateSummary>('set_library', { path })
}

export async function getBooks(): Promise<Book[]> {
  return invoke<Book[]>('get_books')
}

export async function importFiles(
  paths: string[],
  onEvent: (event: ImportEvent) => void,
): Promise<void> {
  const channel = new Channel<ImportEvent>()
  channel.onmessage = onEvent
  await invoke('import_files', { paths, onEvent: channel })
}

export async function importFolder(
  path: string,
  onEvent: (event: ImportEvent) => void,
): Promise<void> {
  const channel = new Channel<ImportEvent>()
  channel.onmessage = onEvent
  await invoke('import_folder', { path, onEvent: channel })
}

export async function importFromCalibre(
  path: string,
  onEvent: (event: ImportEvent) => void,
): Promise<void> {
  const channel = new Channel<ImportEvent>()
  channel.onmessage = onEvent
  await invoke('import_from_calibre', { path, onEvent: channel })
}

export async function pickFolder(title?: string): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title,
  })
  return typeof result === 'string' ? result : null
}

export async function pickBookFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    title: 'Select ebooks to import',
    filters: [{ name: 'Ebooks', extensions: ['epub', 'pdf'] }],
  })
  if (result === null) return []
  return Array.isArray(result) ? result : [result]
}

export function coverUrl(book: Book): string | null {
  return book.cover ? convertFileSrc(book.cover) : null
}
