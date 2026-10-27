import { BookIcon, CircleCheckIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { coverUrl, type Book } from '@/lib/api'
import { statusOf, type ReadingProgress } from '@/lib/progress'

export function BookCard({
  book,
  onSelect,
  progress,
}: {
  book: Book
  onSelect: () => void
  /** Reading progress, if the book has been started or completed. */
  progress?: ReadingProgress
}) {
  const cover = coverUrl(book)
  const status = statusOf(progress)

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
        {status === 'in-progress' && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, progress!.percent)}%` }}
            />
          </div>
        )}
        {status === 'completed' && (
          <CircleCheckIcon className="absolute top-1.5 right-1.5 size-5 rounded-full bg-background/80 text-primary" />
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
          {status === 'in-progress' && (
            <span className="shrink-0">{progress!.percent}%</span>
          )}
        </span>
      </div>
    </button>
  )
}
