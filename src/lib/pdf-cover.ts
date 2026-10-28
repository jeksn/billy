import * as pdfjsLib from 'pdfjs-dist'
import { invoke } from '@tauri-apps/api/core'

import { readBook } from '@/lib/api'

let workerConfigured = false

function ensureWorker() {
  if (workerConfigured) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  workerConfigured = true
}

/**
 * Render page 1 of a PDF to a PNG and store it as the book's cover.
 * Runs entirely in the webview via pdf.js — no native PDF dependency.
 */
export async function renderPdfCover(book: {
  id: string
  path: string
}): Promise<void> {
  ensureWorker()
  const data = new Uint8Array(await readBook(book.path))
  const task = pdfjsLib.getDocument({ data })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({
      scale: 600 / base.width,
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d canvas context')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('failed to encode cover image')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await invoke('save_cover', { bookId: book.id, bytes })
  } finally {
    await task.destroy()
  }
}
