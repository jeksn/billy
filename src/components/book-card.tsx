import { BookIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { coverUrl, type Book } from '@/lib/api'

export function BookCard({
  book,
  onSelect,
  progress,
}: {
  book: Book
  onSelect: () => void
  /** Reading progress in percent, if the book has been started. */
  progress?: number | null
}) {
  const cover = coverUrl(book)
  const showProgress = typeof progress === 'number' && progress > 0

  return (
    <button
      type="button"
      className="flex cursor-pointer flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-md border bg-muted">
        {cover ? (
          <img
            src={cover}
            alt={`Cover of ${book.title}`}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <BookIcon className="size-10" />
          </div>
        )}
        <Badge className="absolute right-1.5 bottom-1.5 uppercase">
          {book.format}
        </Badge>
        {showProgress && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, progress!)}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col">
        <span className="truncate text-sm font-medium" title={book.title}>
          {book.title}
        </span>
        <span
          className="flex items-baseline gap-1 truncate text-xs text-muted-foreground"
          title={book.author ?? undefined}
        >
          <span className="truncate">{book.author ?? 'Unknown author'}</span>
          {showProgress && <span className="shrink-0">{progress}%</span>}
        </span>
      </div>
    </button>
  )
}
