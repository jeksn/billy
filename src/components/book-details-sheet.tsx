import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { BookIcon, FolderSearchIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { coverUrl, type Book } from '@/lib/api'
import { formatSize } from '@/lib/format'

export function BookDetailsSheet({
  book,
  onClose,
}: {
  book: Book | null
  onClose: () => void
}) {
  const cover = book ? coverUrl(book) : null

  return (
    <Sheet open={book !== null} onOpenChange={(open) => !open && onClose()}>
      {book && (
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <div className="flex justify-center p-6 pt-12">
            <div className="relative aspect-[2/3] w-40 overflow-hidden rounded-md border bg-muted">
              {cover ? (
                <img
                  src={cover}
                  alt={`Cover of ${book.title}`}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <BookIcon className="size-10" />
                </div>
              )}
            </div>
          </div>

          <SheetHeader className="gap-1 px-6">
            <SheetTitle className="text-xl">{book.title}</SheetTitle>
            <SheetDescription className="text-base">
              {book.author ?? 'Unknown author'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-6 pt-2 pb-6">
            <div className="flex items-center gap-2">
              <Badge className="uppercase">{book.format}</Badge>
              <Badge variant="secondary">{formatSize(book.fileSize)}</Badge>
            </div>

            <Separator />

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {book.year !== null && (
                <>
                  <dt className="text-muted-foreground">Published</dt>
                  <dd>{book.year}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Imported</dt>
              <dd className="truncate">{book.importedAt}</dd>
              <dt className="text-muted-foreground">Location</dt>
              <dd className="break-all" title={book.path}>
                {book.path}
              </dd>
            </dl>

            <Button
              variant="outline"
              onClick={() => {
                revealItemInDir(book.path).catch((error) =>
                  toast.error(String(error)),
                )
              }}
            >
              <FolderSearchIcon data-icon="inline-start" />
              Show in folder
            </Button>
          </div>
        </SheetContent>
      )}
    </Sheet>
  )
}
