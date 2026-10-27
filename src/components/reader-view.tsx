import 'foliate-js/view.js'
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { readBook, type Book } from '@/lib/api'

interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

interface RelocateDetail {
  fraction?: number
  cfi?: string
}

interface FoliateRenderer extends HTMLElement {
  setStyles?: (css: string) => void
}

interface FoliateView extends HTMLElement {
  open(target: File | Blob): Promise<void>
  goTo(target: string | number): Promise<void>
  prev(): Promise<void>
  next(): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  renderer: FoliateRenderer
  book: { toc?: TocItem[] }
}

const IS_MAC = /Mac/i.test(navigator.userAgent)

function progressKey(id: string) {
  return `billy.progress.${id}`
}

function loadProgress(id: string): string | null {
  const raw = localStorage.getItem(progressKey(id))
  if (raw === null) return null
  try {
    return (JSON.parse(raw) as { cfi?: string }).cfi ?? null
  } catch {
    return null
  }
}

function saveProgress(id: string, cfi: string) {
  localStorage.setItem(progressKey(id), JSON.stringify({ cfi }))
}

function TocList({
  items,
  onNavigate,
}: {
  items: TocItem[]
  onNavigate: (href: string) => void
}) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.href} className="flex flex-col">
          <button
            type="button"
            className="cursor-pointer truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
            onClick={() => onNavigate(item.href)}
            title={item.label}
          >
            {item.label}
          </button>
          {item.subitems && item.subitems.length > 0 && (
            <div className="ml-3 border-l pl-1">
              <TocList items={item.subitems} onNavigate={onNavigate} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ReaderView({
  book,
  onClose,
}: {
  book: Book
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [toc, setToc] = useState<TocItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [fontSize, setFontSize] = usePersistentState<number>(
    'billy.reader.fontSize',
    100,
  )

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    const view = document.createElement('foliate-view') as FoliateView
    // Custom elements are display:inline by default, where height is ignored.
    view.style.display = 'block'
    view.style.height = '100%'
    viewRef.current = view

    view.addEventListener('relocate', (event) => {
      const detail = (event as CustomEvent<RelocateDetail>).detail
      if (detail.fraction !== undefined) {
        setPercent(Math.round(detail.fraction * 100))
      }
      if (detail.cfi) {
        saveProgress(book.id, detail.cfi)
      }
    })

    container.appendChild(view)

    const open = async () => {
      try {
        const bytes = await readBook(book.path)
        if (cancelled) return
        const file = new File([bytes], 'book.epub', {
          type: 'application/epub+zip',
        })
        await view.open(file)
        if (cancelled) {
          view.remove()
          return
        }
        const renderer = view.renderer
        // Book-like margins and a readable text column.
        renderer?.setAttribute?.('margin', '64px')
        renderer?.setAttribute?.('max-inline-size', '720px')
        renderer?.setStyles?.(`html { font-size: ${fontSize}% }`)
        setToc(view.book.toc ?? [])
        const cfi = loadProgress(book.id)
        await view.goTo(cfi ?? 0)
        setStatus('ready')
      } catch (error) {
        if (!cancelled) {
          setStatus('error')
          toast.error(`Failed to open book: ${String(error)}`)
        }
      }
    }
    void open()

    return () => {
      cancelled = true
      view.remove()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.path])

  useEffect(() => {
    if (status !== 'ready') return
    viewRef.current?.renderer?.setStyles?.(`html { font-size: ${fontSize}% }`)
  }, [fontSize, status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const view = viewRef.current
      if (!view) return
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowRight') {
        void view.goRight()
      } else if (event.key === 'ArrowLeft') {
        void view.goLeft()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const adjustFont = (delta: number) => {
    setFontSize(Math.min(200, Math.max(60, fontSize + delta)))
  }

  return (
    <div className="reader-surface fixed inset-0 z-50 bg-background">
      {/* Book content fills the entire window; chrome floats on top. */}
      <div ref={containerRef} className="absolute inset-0" />

      <header
        className={cn(
          'absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-4 py-2',
          'bg-background/70 backdrop-blur',
          IS_MAC && 'pl-20',
        )}
      >
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <ArrowLeftIcon />
          <span className="sr-only">Back to library</span>
        </Button>
        <span className="truncate text-sm font-medium" title={book.title}>
          {book.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {percent !== null ? `${percent}%` : ''}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => adjustFont(-10)}
          >
            <MinusIcon />
            <span className="sr-only">Decrease font size</span>
          </Button>
          <span className="w-10 text-center text-xs text-muted-foreground">
            {fontSize}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => adjustFont(10)}
          >
            <PlusIcon />
            <span className="sr-only">Increase font size</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTocOpen((open) => !open)}
          >
            {tocOpen ? <XIcon /> : <ListIcon />}
            <span className="sr-only">Toggle table of contents</span>
          </Button>
        </div>
      </header>

      {tocOpen && (
        <nav className="absolute top-11 bottom-0 left-0 z-20 w-64 overflow-y-auto border-r bg-background/90 p-2 backdrop-blur">
          <TocList
            items={toc}
            onNavigate={(href) => {
              void viewRef.current?.goTo(href)
            }}
          />
        </nav>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          Opening book...
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          Could not open this book.
        </div>
      )}

      {status === 'ready' && (
        <>
          <button
            type="button"
            aria-label="Previous page"
            className={cn(
              'absolute inset-y-0 left-0 z-10 flex w-16 cursor-pointer items-center justify-start pl-2',
              'opacity-30 transition-opacity hover:opacity-100',
            )}
            onClick={() => void viewRef.current?.goLeft()}
          >
            <ChevronLeftIcon className="size-8" />
          </button>
          <button
            type="button"
            aria-label="Next page"
            className={cn(
              'absolute inset-y-0 right-0 z-10 flex w-16 cursor-pointer items-center justify-end pr-2',
              'opacity-30 transition-opacity hover:opacity-100',
            )}
            onClick={() => void viewRef.current?.goRight()}
          >
            <ChevronRightIcon className="size-8" />
          </button>
        </>
      )}
    </div>
  )
}
