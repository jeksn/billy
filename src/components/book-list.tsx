import { BookIcon, TabletIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { coverUrl, type Book } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { statusOf, type ReadingProgress } from '@/lib/progress'

export function BookList({
  books,
  onSelect,
  progressMap,
  rowWrapper,
  isOnDevice,
}: {
  books: Book[]
  onSelect: (book: Book) => void
  progressMap: Map<string, ReadingProgress>
  /** Wraps each row, e.g. in a context menu. */
  rowWrapper?: (book: Book, row: ReactNode) => ReactNode
  isOnDevice: (book: Book) => boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {books.map((book) => {
        const cover = coverUrl(book)
        const progress = progressMap.get(book.id)
        const status = statusOf(progress)
        const row = (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(book)}
          >
            <div className="aspect-[2/3] w-9 shrink-0 overflow-hidden rounded-sm border bg-muted">
              {cover ? (
                <img
                  src={cover}
                  alt={`Cover of ${book.title}`}
                  className="size-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <BookIcon className="size-3" />
                </div>
              )}
            </div>

            <span
              className="flex-1 truncate text-sm font-medium"
              title={book.title}
            >
              {book.title}
            </span>
            <span
              className="hidden w-44 truncate text-sm text-muted-foreground sm:block"
              title={book.author ?? undefined}
            >
              {book.author ?? 'Unknown author'}
            </span>
            <span className="hidden w-12 text-sm text-muted-foreground lg:block">
              {book.year ?? ''}
            </span>
            {status === 'in-progress' && progress && (
              <span className="w-10 text-xs text-primary">
                {progress.percent}%
              </span>
            )}
            {status === 'completed' && (
              <span className="w-16 text-xs text-muted-foreground">
                Read
              </span>
            )}
            {isOnDevice(book) && (
              <span
                className="w-5 text-muted-foreground"
                title="On device"
                aria-label="On device"
              >
                <TabletIcon className="size-3.5" />
              </span>
            )}
            <Badge variant="secondary" className="uppercase">
              {book.format}
            </Badge>
            <span className="hidden w-16 text-right text-xs text-muted-foreground md:block">
              {formatSize(book.fileSize)}
            </span>
          </button>
        )
        return (
          <div key={book.id}>
            {rowWrapper ? rowWrapper(book, row) : row}
          </div>
        )
      })}
    </div>
  )
}
