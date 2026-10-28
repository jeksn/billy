import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  BookIcon,
  BookOpenIcon,
  CircleCheckIcon,
  FolderSearchIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { coverUrl, openBook, type Book } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { statusOf, type ReadingProgress } from '@/lib/progress'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'

export function BookDetailsSheet({
  book,
  progress,
  onClose,
  onDelete,
  onMetadataSave,
  onRead,
  onMarkRead,
  onMarkUnread,
}: {
  book: Book | null
  progress?: ReadingProgress
  onClose: () => void
  onDelete: (book: Book) => Promise<void>
  onMetadataSave: (
    book: Book,
    title: string,
    author: string | null,
    year: number | null,
  ) => Promise<Book>
  onRead: (book: Book) => void
  onMarkRead: (book: Book) => void
  onMarkUnread: (book: Book) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [year, setYear] = useState('')

  useEffect(() => {
    if (book) {
      setTitle(book.title)
      setAuthor(book.author ?? '')
      setYear(book.year === null ? '' : String(book.year))
    }
  }, [book])

  const cover = book ? coverUrl(book) : null
  const readState = statusOf(progress)

  const saveMetadata = async () => {
    if (!book || !title.trim()) return
    setSaving(true)
    try {
      const parsedYear = year.trim() === '' ? null : Number(year)
      const validYear =
        parsedYear !== null && Number.isFinite(parsedYear) && parsedYear >= 1000
          ? Math.trunc(parsedYear)
          : null
      await onMetadataSave(book, title.trim(), author.trim() || null, validYear)
      setEditOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={book !== null} onOpenChange={(open) => !open && onClose()}>
      {book && (
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <div className="flex justify-center p-6 pt-12">
            <button
              type="button"
              className="relative aspect-[2/3] w-40 cursor-zoom-in overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => cover && setCoverPreviewOpen(true)}
            >
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
            </button>
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

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    if (book.format === 'epub') {
                      onRead(book)
                    } else {
                      openBook(book.path).catch((error) =>
                        toast.error(String(error)),
                      )
                    }
                  }}
                >
                  <BookOpenIcon data-icon="inline-start" />
                  {book.format === 'epub' ? 'Read' : 'Open'}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setEditOpen(true)}
                >
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (readState === 'completed') {
                      onMarkUnread(book)
                    } else {
                      onMarkRead(book)
                    }
                  }}
                >
                  <CircleCheckIcon data-icon="inline-start" />
                  {readState === 'completed' ? 'Mark as unread' : 'Mark as read'}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
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
              <Button
                variant="outline"
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </div>
          </div>

          <Dialog
            open={coverPreviewOpen}
            onOpenChange={setCoverPreviewOpen}
          >
            <DialogContent
              className="w-auto max-w-3xl bg-transparent p-0 ring-0"
              showCloseButton={false}
              onClick={() => setCoverPreviewOpen(false)}
            >
              <DialogHeader className="sr-only">
                <DialogTitle>Cover preview</DialogTitle>
                <DialogDescription>
                  Full-size view of the book cover.
                </DialogDescription>
              </DialogHeader>
              {cover && (
                <img
                  src={cover}
                  alt={`Cover of ${book.title}`}
                  className="max-h-[85vh] w-auto rounded-lg shadow-2xl"
                />
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Edit book</DialogTitle>
                <DialogDescription>
                  The book's folder and file are renamed to match.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="edit-title">Title</FieldLabel>
                  <Input
                    id="edit-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-author">Author</FieldLabel>
                  <Input
                    id="edit-author"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Unknown author"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-year">Year</FieldLabel>
                  <Input
                    id="edit-year"
                    type="number"
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                    placeholder="—"
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setEditOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void saveMetadata()}
                  disabled={saving || !title.trim()}
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <ConfirmDeleteDialog
            book={deleteOpen ? book : null}
            onConfirm={(target) => void onDelete(target)}
            onCancel={() => setDeleteOpen(false)}
          />
        </SheetContent>
      )}
    </Sheet>
  )
}
