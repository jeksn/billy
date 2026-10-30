import type { ReactNode } from 'react'
import {
  BookOpenIcon,
  CircleCheckIcon,
  FolderSearchIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { Book, ReaderDevice } from '@/lib/api'
import { statusOf, type ReadingProgress } from '@/lib/progress'

export function BookContextMenu({
  book,
  progress,
  devices,
  children,
  onRead,
  onMarkComplete,
  onMarkUnread,
  onReveal,
  onDelete,
  onSend,
}: {
  book: Book
  progress?: ReadingProgress
  devices: ReaderDevice[]
  children: ReactNode
  onRead: (book: Book) => void
  onMarkComplete: (book: Book) => void
  onMarkUnread: (book: Book) => void
  onReveal: (book: Book) => void
  onDelete: (book: Book) => void
  onSend: (book: Book, device: ReaderDevice) => void
}) {
  const status = statusOf(progress)
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="contents" />}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onRead(book)}>
          <BookOpenIcon data-icon="inline-start" />
          {book.format === 'epub' ? 'Read...' : 'Open...'}
        </ContextMenuItem>
        {devices.map((device) => (
          <ContextMenuItem key={device.path} onClick={() => onSend(book, device)}>
            <SendIcon data-icon="inline-start" />
            Send to {device.label}
          </ContextMenuItem>
        ))}
        {status !== 'completed' && (
          <ContextMenuItem onClick={() => onMarkComplete(book)}>
            <CircleCheckIcon data-icon="inline-start" />
            Mark as read
          </ContextMenuItem>
        )}
        {status !== 'unread' && (
          <ContextMenuItem onClick={() => onMarkUnread(book)}>
            Mark as unread
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onReveal(book)}>
          <FolderSearchIcon data-icon="inline-start" />
          Show in folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onDelete(book)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete...
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
