import { BookIcon, CircleCheckIcon, TabletIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { coverUrl, type Book } from '@/lib/api'
import { statusOf, type ReadingProgress } from '@/lib/progress'

export function BookCard({
  book,
  onSelect,
  progress,
  onDevice,
}: {
  book: Book
  onSelect: () => void
  /** Reading progress, if the book has been started or completed. */
  progress?: ReadingProgress
  /** Whether the book is already on a connected e-reader. */
  onDevice?: boolean
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
          <Badge variant="secondary" className="absolute bottom-1.5 left-1.5">
            {progress!.percent}%
          </Badge>
        )}
        {status === 'completed' && (
          <CircleCheckIcon className="absolute top-1.5 right-1.5 size-5 rounded-full bg-background/80 text-primary" />
        )}
        {onDevice && (
          <TabletIcon
            className="absolute top-1.5 left-1.5 size-5 rounded-full bg-background/80 text-primary"
            aria-label="On device"
          />
        )}
      </div>
      <div className="flex flex-col">
        <span className="truncate text-sm font-medium" title={book.title}>
          {book.title}
        </span>
        <span
          className="truncate text-xs text-muted-foreground"
          title={book.author ?? undefined}
        >
          {book.author ?? 'Unknown author'}
        </span>
      </div>
    </button>
  )
}
