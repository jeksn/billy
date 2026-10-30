import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  BookIcon,
  BookOpenIcon,
  FilePlus2Icon,
  SearchIcon,
  SettingsIcon,
} from 'lucide-react'

import { cn } from 'cn'

import { BookCard } from '@/components/book-card'
import { BookContextMenu } from '@/components/book-context-menu'
import { BookDetailsSheet } from '@/components/book-details-sheet'
import { BookList } from '@/components/book-list'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { LibrarySetup } from '@/components/library-setup'
import { ReaderView } from '@/components/reader-view'
import { SettingsSheet } from '@/components/settings-sheet'
import {
  EMPTY_FILTERS,
  SearchDialog,
  hasActiveFilters,
  type Filters,
} from '@/components/search-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { renderPdfCover } from '@/lib/pdf-cover'
import { normalizeTitle, deviceTitlePortion } from '@/lib/matching'
import {
  deleteBook,
  getBooks,
  getAppState,
  importFiles,
  importFolder,
  importFromCalibre,
  openBook,
  pickBookFiles,
  pickFolder,
  getDevices,
  listDeviceBooks,
  sendToDevice,
  setLibrary,
  updateBookMetadata,
  type AppStateSummary,
  type Book,
  type ImportEvent,
  type ReaderDevice,
} from '@/lib/api'
import {
  clearProgress,
  isInProgress,
  loadAllProgress,
  migrateLegacyProgress,
  saveProgress,
  statusOf,
  type ReadingProgress,
} from '@/lib/progress'

type ViewMode = 'grid' | 'list'
type GridSize = 'small' | 'medium' | 'large'

const GRID_SIZES: Record<GridSize, string> = {
  small:
    'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
  medium:
    'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
  large:
    'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
}

const IS_MAC = /Mac/i.test(navigator.userAgent)

export default function App() {
  const [summary, setSummary] = useState<AppStateSummary | null>(null)
  const [books, setBooks] = useState<Book[]>([])
  const [booksLoaded, setBooksLoaded] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [readingBook, setReadingBook] = useState<Book | null>(null)
  const [progressMap, setProgressMap] = useState<
    Map<string, ReadingProgress>
  >(new Map())
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null)
  const [devices, setDevices] = useState<ReaderDevice[]>([])
  const [deviceBooks, setDeviceBooks] = useState<Set<string>>(new Set())
  const [deviceTitles, setDeviceTitles] = useState<Set<string>>(new Set())
  const deviceSignatureRef = useRef('')

  const refreshDeviceBooks = useCallback(async (found: ReaderDevice[]) => {
    if (found.length === 0) {
      setDeviceBooks(new Set())
      setDeviceTitles(new Set())
      return
    }
    try {
      const lists = await Promise.all(
        found.map((device) => listDeviceBooks(device.path)),
      )
      const names = lists.flat()
      setDeviceBooks(new Set(names))
      setDeviceTitles(
        new Set(names.map((name) => normalizeTitle(deviceTitlePortion(name)))),
      )
    } catch {
      setDeviceBooks(new Set())
      setDeviceTitles(new Set())
    }
  }, [])

  useEffect(() => {
    const poll = () => {
      getDevices()
        .then((found) => {
          setDevices(found)
          const signature = found.map((d) => d.path).join('|')
          if (signature !== deviceSignatureRef.current) {
            deviceSignatureRef.current = signature
            void refreshDeviceBooks(found)
          }
        })
        .catch(() => {})
    }
    poll()
    const timer = window.setInterval(poll, 5000)
    return () => window.clearInterval(timer)
  }, [refreshDeviceBooks])

  const isOnDevice = useCallback(
    (book: Book) => {
      const base = (book.path.split('/').pop() ?? '').replace(
        /\.(epub|pdf)$/i,
        '',
      )
      if (deviceBooks.has(base.trim().toLowerCase())) return true
      return deviceTitles.has(normalizeTitle(book.title))
    },
    [deviceBooks, deviceTitles],
  )

  const handleSend = async (book: Book, device: ReaderDevice) => {
    try {
      await sendToDevice(book.id, device.path, sendKepub, sendAuthorFolders)
      const base = (book.path.split('/').pop() ?? '')
        .replace(/\.(epub|pdf)$/i, '')
        .trim()
        .toLowerCase()
      setDeviceBooks((prev) => new Set(prev).add(base))
      toast.success(`Sent "${book.title}" to ${device.label}`)
    } catch (error) {
      toast.error(String(error))
    }
  }

  const refreshProgress = useCallback(async () => {
    setProgressMap(await loadAllProgress())
  }, [])

  useEffect(() => {
    void (async () => {
      await migrateLegacyProgress()
      await refreshProgress()
    })()
  }, [refreshProgress])
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(
    'billy.viewMode',
    'grid',
  )
  const [gridSize, setGridSize] = usePersistentState<GridSize>(
    'billy.gridSize',
    'medium',
  )
  const [sortMode, setSortMode] = usePersistentState<SortMode>(
    'billy.sortMode',
    'author',
  )
  const [hideRead, setHideRead] = usePersistentState<boolean>(
    'billy.hideRead',
    false,
  )
  const [sendKepub, setSendKepub] = usePersistentState<boolean>(
    'billy.sendKepub',
    true,
  )
  const [sendAuthorFolders, setSendAuthorFolders] = usePersistentState<boolean>(
    'billy.sendAuthorFolders',
    true,
  )
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [importing, setImporting] = useState<{
    current: number
    total: number
  } | null>(null)

  const attemptedCoversRef = useRef(new Set<string>())

  const refreshBooks = useCallback(async () => {
    try {
      let list = await getBooks()
      setBooks(list)

      // Generate covers for PDFs that lack one, using pdf.js in the webview.
      const targets = list.filter(
        (book) =>
          book.format === 'pdf' &&
          !book.cover &&
          !attemptedCoversRef.current.has(book.id),
      )
      for (const book of targets) {
        attemptedCoversRef.current.add(book.id)
      }
      let generated = 0
      for (const book of targets) {
        try {
          await renderPdfCover(book)
          generated++
        } catch {
          // Skip books that fail to render; they keep the placeholder cover.
        }
      }
      if (generated > 0) {
        list = await getBooks()
        setBooks(list)
        toast.success(
          generated === 1
            ? 'Generated 1 PDF cover'
            : `Generated ${generated} PDF covers`,
        )
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBooksLoaded(true)
    }
  }, [])

  useEffect(() => {
    getAppState()
      .then(async (state) => {
        setSummary(state)
        if (state.libraryPath) {
          await refreshBooks()
        } else {
          setBooksLoaded(true)
        }
      })
      .catch((error) => {
        toast.error(String(error))
        setBooksLoaded(true)
      })
  }, [refreshBooks])

  const chooseLibrary = async () => {
    const path = await pickFolder()
    if (!path) return
    try {
      const state = await setLibrary(path)
      setSummary(state)
      await refreshBooks()
      toast.success('Library ready')
    } catch (error) {
      toast.error(String(error))
    }
  }

  const runImport = async (
    start: (onEvent: (event: ImportEvent) => void) => Promise<void>,
  ) => {
    setImporting({ current: 0, total: 0 })
    const result = { imported: 0, skipped: 0, failed: 0 }
    const failures: string[] = []
    try {
      await start((event) => {
        if (event.event === 'Progress') {
          setImporting({
            current: event.data.current,
            total: event.data.total,
          })
        } else if (event.event === 'Imported') {
          result.imported++
        } else if (event.event === 'Skipped') {
          result.skipped++
        } else if (event.event === 'Failed') {
          result.failed++
          if (failures.length < 3) {
            failures.push(`${event.data.file}: ${event.data.error}`)
          }
        }
      })
      if (result.imported > 0) {
        const parts = [`${result.imported} imported`]
        if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
        if (result.failed > 0) parts.push(`${result.failed} failed`)
        toast.success(parts.join(', '))
      } else if (result.skipped > 0) {
        toast.info(`No new books — ${result.skipped} already in the library`)
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} file(s) failed to import`, {
          description: failures.join('\n'),
        })
      }
      await refreshBooks()
      await refreshProgress()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setImporting(null)
    }
  }

  const importPickedFiles = async () => {
    const paths = await pickBookFiles()
    if (paths.length === 0) return
    await runImport((onEvent) => importFiles(paths, onEvent))
  }

  const importPickedFolder = async () => {
    const path = await pickFolder('Choose a folder to import from')
    if (!path) return
    await runImport((onEvent) => importFolder(path, onEvent))
  }

  const importCalibreLibrary = async (calibrePath?: string) => {
    const path = calibrePath ?? (await pickFolder('Select your Calibre Library folder'))
    if (!path) return
    await runImport((onEvent) => importFromCalibre(path, onEvent))
  }

  const sortedBooks = useMemo(
    () => sortBooks(books, sortMode),
    [books, sortMode],
  )

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return sortedBooks.filter((book) => {
      if (
        q &&
        !book.title.toLowerCase().includes(q) &&
        !(book.author ?? '').toLowerCase().includes(q)
      ) {
        return false
      }
      if (
        filters.authors.length > 0 &&
        !filters.authors.includes(book.author ?? '')
      ) {
        return false
      }
      if (
        filters.formats.length > 0 &&
        !filters.formats.includes(book.format)
      ) {
        return false
      }
      if (
        filters.years.length > 0 &&
        !(book.year !== null && filters.years.includes(String(book.year)))
      ) {
        return false
      }
      if (
        hideRead &&
        filters.statuses.length === 0 &&
        statusOf(progressMap.get(book.id)) === 'completed'
      ) {
        return false
      }
      if (
        filters.statuses.length > 0 &&
        !filters.statuses.includes(statusOf(progressMap.get(book.id)))
      ) {
        return false
      }
      return true
    })
  }, [sortedBooks, filters, progressMap, hideRead])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const currentlyReading = useMemo(() => {
    return books
      .filter((book) => isInProgress(progressMap.get(book.id)))
      .sort(
        (a, b) =>
          (progressMap.get(b.id)?.at ?? 0) - (progressMap.get(a.id)?.at ?? 0),
      )
  }, [books, progressMap])

  if (summary === null || !booksLoaded) {
    return (
      <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[2/3] rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (!summary.libraryPath) {
    return <LibrarySetup onChoose={chooseLibrary} />
  }

  const handleDelete = async (book: Book) => {
    try {
      await deleteBook(book.id)
      setSelectedBook(null)
      await Promise.all([refreshBooks(), refreshProgress()])
      toast.success(`Deleted "${book.title}"`)
    } catch (error) {
      toast.error(String(error))
    }
  }

  const handleMetadataSave = async (
    book: Book,
    title: string,
    author: string | null,
    year: number | null,
  ): Promise<Book> => {
    try {
      const updated = await updateBookMetadata(book.id, title, author, year)
      setSelectedBook(updated)
      await refreshBooks()
      toast.success('Metadata updated')
      return updated
    } catch (error) {
      toast.error(String(error))
      throw error
    }
  }

  const handleMarkComplete = async (book: Book) => {
    await saveProgress(
      book.id,
      progressMap.get(book.id)?.cfi ?? null,
      100,
      Date.now(),
    )
    await refreshProgress()
    toast.success(`Marked "${book.title}" as completed`)
  }

  const handleMarkUnread = async (book: Book) => {
    await clearProgress(book.id)
    await refreshProgress()
    toast.success(`Marked "${book.title}" as unread`)
  }

  const handleReveal = (book: Book) => {
    revealItemInDir(book.path).catch((error) => toast.error(String(error)))
  }

  const readOrOpen = (book: Book) => {
    if (book.format === 'epub') {
      setReadingBook(book)
    } else {
      openBook(book.path).catch((error) => toast.error(String(error)))
    }
  }

  const renderContextMenu = (book: Book, children: React.ReactNode) => (
    <BookContextMenu
      book={book}
      progress={progressMap.get(book.id)}
      devices={devices}
      onRead={readOrOpen}
      onMarkComplete={handleMarkComplete}
      onMarkUnread={handleMarkUnread}
      onReveal={handleReveal}
      onDelete={setPendingDelete}
      onSend={(target, device) => void handleSend(target, device)}
    >
      {children}
    </BookContextMenu>
  )

  return (
    <div className="flex min-h-svh flex-col">
      <header
        data-tauri-drag-region
        className={cn(
          'sticky top-0 z-20 flex items-center gap-3 bg-muted/40 px-6 py-3.5 backdrop-blur',
          IS_MAC && 'pl-20',
        )}
      >
        <div className="ml-auto flex items-center gap-3">
          {importing && (
            <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {importing.total > 0
                ? `Importing ${importing.current}/${importing.total}`
                : 'Importing...'}
            </span>
          )}

          <Button
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="justify-start font-normal text-muted-foreground"
          >
            <SearchIcon data-icon="inline-start" />
            {hasActiveFilters(filters) ? 'Filtered' : 'Search books...'}
            <span className="ml-auto text-xs tracking-widest">
              {IS_MAC ? '⌘K' : 'Ctrl K'}
            </span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button disabled={importing !== null}>
                  <FilePlus2Icon data-icon="inline-start" />
                  Import
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => void importPickedFiles()}>
                Add files...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void importPickedFolder()}>
                Add from folder...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
            <span className="sr-only">Settings</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 bg-muted/40 p-6">
        {currentlyReading.length > 0 && !hasActiveFilters(filters) && (
          <section className="mb-6 flex flex-col gap-3">
            <h2 className="text-sm font-medium">Continue reading</h2>
            <div className={cn('grid gap-4', GRID_SIZES[gridSize])}>
              {currentlyReading.map((book) =>
                renderContextMenu(
                  book,
                  <BookCard
                    book={book}
                    progress={progressMap.get(book.id)}
                    onDevice={isOnDevice(book)}
                    onSelect={() => setReadingBook(book)}
                  />,
                ),
              )}
            </div>
          </section>
        )}

        {filtered.length === 0 ? (
        books.length === 0 ? (
          <Empty className="min-h-96 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookIcon />
              </EmptyMedia>
              <EmptyTitle>No books yet</EmptyTitle>
              <EmptyDescription>
                Import your first EPUB or PDF to get started.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {summary.calibreLibraryPath ? (
                <>
                  <Button onClick={() => void importCalibreLibrary(summary.calibreLibraryPath!)}>
                    <BookOpenIcon data-icon="inline-start" />
                    Migrate from Calibre
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Found your Calibre library at {summary.calibreLibraryPath}
                  </span>
                </>
              ) : (
                <Button onClick={() => void importPickedFiles()}>
                  <FilePlus2Icon data-icon="inline-start" />
                  Import books
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="min-h-96 border">
            <EmptyHeader>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>
              Nothing matches your search and filters.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
        ) : viewMode === 'list' ? (
          <BookList
            books={filtered}
            onSelect={setSelectedBook}
            progressMap={progressMap}
            rowWrapper={renderContextMenu}
            isOnDevice={isOnDevice}
          />
        ) : (
          <div className={cn('grid gap-4', GRID_SIZES[gridSize])}>
            {filtered.map((book) =>
              renderContextMenu(
                book,
                <BookCard
                  key={book.id}
                  book={book}
                  progress={progressMap.get(book.id)}
                  onDevice={isOnDevice(book)}
                  onSelect={() => setSelectedBook(book)}
                />,
              ),
            )}
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 bg-muted/40 px-6 py-1.5 text-xs text-muted-foreground backdrop-blur">
        {filtered.length === books.length
          ? `${books.length} ${books.length === 1 ? 'book' : 'books'}`
          : `${filtered.length} of ${books.length} books`}
      </footer>

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        books={books}
        filters={filters}
        onFiltersChange={setFilters}
        resultCount={filtered.length}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        libraryPath={summary.libraryPath}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        hideRead={hideRead}
        onHideReadChange={setHideRead}
        sendKepub={sendKepub}
        onSendKepubChange={setSendKepub}
        sendAuthorFolders={sendAuthorFolders}
        onSendAuthorFoldersChange={setSendAuthorFolders}
        onChooseLibrary={() => {
          setSettingsOpen(false)
          void chooseLibrary()
        }}
        onImportFromCalibre={() => {
          setSettingsOpen(false)
          void importCalibreLibrary()
        }}
      />

      <BookDetailsSheet
        book={selectedBook}
        progress={
          selectedBook ? progressMap.get(selectedBook.id) : undefined
        }
        onClose={() => setSelectedBook(null)}
        onDelete={handleDelete}
        onMetadataSave={handleMetadataSave}
        onRead={(book) => {
          setSelectedBook(null)
          setReadingBook(book)
        }}
        onMarkRead={handleMarkComplete}
        onMarkUnread={handleMarkUnread}
      />

      {readingBook && (
        <ReaderView
          book={readingBook}
          resumeCfi={progressMap.get(readingBook.id)?.cfi ?? null}
          onClose={() => {
            setReadingBook(null)
            void refreshProgress()
          }}
        />
      )}

      <ConfirmDeleteDialog
        book={pendingDelete}
        onConfirm={(book) => {
          setPendingDelete(null)
          void handleDelete(book)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

export type SortMode = 'author' | 'title' | 'recent' | 'year'

function sortBooks(books: Book[], mode: SortMode): Book[] {
  const sorted = [...books]
  switch (mode) {
    case 'title':
      sorted.sort(
        (a, b) =>
          a.title.localeCompare(b.title) ||
          (a.author ?? '').localeCompare(b.author ?? ''),
      )
      break
    case 'recent':
      sorted.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
      break
    case 'year':
      sorted.sort(
        (a, b) =>
          (b.year ?? -1) - (a.year ?? -1) || a.title.localeCompare(b.title),
      )
      break
    case 'author':
      sorted.sort((a, b) => {
        const authorA = (a.author ?? '\uffff').toLowerCase()
        const authorB = (b.author ?? '\uffff').toLowerCase()
        if (authorA !== authorB) return authorA.localeCompare(authorB)
        return a.title.localeCompare(b.title)
      })
      break
  }
  return sorted
}
