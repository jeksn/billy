import { SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'
import type { Book } from '@/lib/api'

export interface Filters {
  query: string
  authors: string[]
  formats: string[]
  years: string[]
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  authors: [],
  formats: [],
  years: [],
}

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.authors.length > 0 ||
    filters.formats.length > 0 ||
    filters.years.length > 0
  )
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value]
}

function facetCounts(books: Book[], key: (book: Book) => string | null) {
  const counts = new Map<string, number>()
  for (const book of books) {
    const value = key(book)
    if (value !== null) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return counts
}

export function SearchDialog({
  open,
  onOpenChange,
  books,
  filters,
  onFiltersChange,
  resultCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  books: Book[]
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  resultCount: number
}) {
  const authors = [...facetCounts(books, (b) => b.author).entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )
  const years = [...facetCounts(books, (b) =>
    b.year === null ? null : String(b.year),
  ).entries()].sort(([a], [b]) => Number(b) - Number(a))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search books</DialogTitle>
          <DialogDescription>
            Combine text with any of the filters below. Results update live in
            the library.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={filters.query}
            onChange={(event) =>
              onFiltersChange({ ...filters, query: event.target.value })
            }
            placeholder="Search by title or author..."
            className="pl-8"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Format
          </span>
          <ToggleGroup
            variant="outline"
            size="sm"
            multiple
            value={filters.formats}
            onValueChange={(formats) =>
              onFiltersChange({ ...filters, formats })
            }
          >
            <ToggleGroupItem value="epub">EPUB</ToggleGroupItem>
            <ToggleGroupItem value="pdf">PDF</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Separator />

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Authors
          </span>
          <ScrollArea className="max-h-44 rounded-md border p-2">
            <div className="flex flex-col gap-1">
              {authors.map(([author, count]) => (
                <label
                  key={author}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm"
                >
                  <Checkbox
                    checked={filters.authors.includes(author)}
                    onCheckedChange={() =>
                      onFiltersChange({
                        ...filters,
                        authors: toggle(filters.authors, author),
                      })
                    }
                  />
                  <span className="flex-1 truncate" title={author}>
                    {author}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {count}
                  </span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </div>

        {years.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Year
            </span>
            <ScrollArea className="max-h-36 rounded-md border p-2">
              <div className="flex flex-col gap-1">
                {years.map(([year, count]) => (
                  <label
                    key={year}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm"
                  >
                    <Checkbox
                      checked={filters.years.includes(year)}
                      onCheckedChange={() =>
                        onFiltersChange({
                          ...filters,
                          years: toggle(filters.years, year),
                        })
                      }
                    />
                    <span className="flex-1">{year}</span>
                    <span className="text-xs text-muted-foreground">
                      {count}
                    </span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {resultCount} of {books.length} books
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          >
            Clear
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
