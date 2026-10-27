import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  BookIcon,
  FilePlus2Icon,
  SearchIcon,
  SettingsIcon,
} from 'lucide-react'

import { cn } from 'cn'

import { BookCard } from '@/components/book-card'
import { BookDetailsSheet } from '@/components/book-details-sheet'
import { BookList } from '@/components/book-list'
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
import {
  deleteBook,
  getBooks,
  getAppState,
  importFiles,
  importFolder,
  importFromCalibre,
  pickBookFiles,
  pickFolder,
  setLibrary,
  updateBookMetadata,
  type AppStateSummary,
  type Book,
  type ImportEvent,
} from '@/lib/api'
import {
  isInProgress,
  loadAllProgress,
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

  const refreshProgress = useCallback(() => {
    setProgressMap(loadAllProgress())
  }, [])

  useEffect(() => {
    refreshProgress()
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
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [importing, setImporting] = useState<{
    current: number
    total: number
  } | null>(null)

  const refreshBooks = useCallback(async () => {
    try {
      setBooks(await getBooks())
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

  const importCalibreLibrary = async () => {
    const path = await pickFolder('Select your Calibre Library folder')
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
      return true
    })
  }, [sortedBooks, filters])

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
      await refreshBooks()
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
            <div className="flex gap-4 overflow-x-auto pb-2">
              {currentlyReading.map((book) => (
                <div key={book.id} className="w-32 shrink-0">
                  <BookCard
                    book={book}
                    progress={progressMap.get(book.id)?.percent}
                    onSelect={() => setReadingBook(book)}
                  />
                </div>
              ))}
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
              <Button onClick={() => void importPickedFiles()}>
                <FilePlus2Icon data-icon="inline-start" />
                Import books
              </Button>
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
          />
        ) : (
          <div className={cn('grid gap-4', GRID_SIZES[gridSize])}>
            {filtered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                progress={progressMap.get(book.id)?.percent}
                onSelect={() => setSelectedBook(book)}
              />
            ))}
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
        onClose={() => setSelectedBook(null)}
        onDelete={handleDelete}
        onMetadataSave={handleMetadataSave}
        onRead={(book) => {
          setSelectedBook(null)
          setReadingBook(book)
        }}
      />

      {readingBook && (
        <ReaderView
          book={readingBook}
          onClose={() => {
            setReadingBook(null)
            refreshProgress()
          }}
        />
      )}
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
