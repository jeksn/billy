import { useTheme } from 'next-themes'
import {
  BookOpenIcon,
  FolderOpenIcon,
  LayoutGridIcon,
  ListIcon,
  SettingsIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

const GRID_SIZE_OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
] as const

const SORT_OPTIONS = [
  { value: 'author', label: 'Author' },
  { value: 'title', label: 'Title' },
  { value: 'recent', label: 'Recently imported' },
  { value: 'year', label: 'Year' },
] as const

export function SettingsSheet({
  open,
  onOpenChange,
  libraryPath,
  onChooseLibrary,
  onImportFromCalibre,
  viewMode,
  onViewModeChange,
  gridSize,
  onGridSizeChange,
  sortMode,
  onSortModeChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  libraryPath: string | null
  onChooseLibrary: () => void
  onImportFromCalibre: () => void
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  gridSize: 'small' | 'medium' | 'large'
  onGridSizeChange: (size: 'small' | 'medium' | 'large') => void
  sortMode: 'author' | 'title' | 'recent' | 'year'
  onSortModeChange: (mode: 'author' | 'title' | 'recent' | 'year') => void
}) {
  const { theme, setTheme } = useTheme()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="flex items-center gap-2">
            <SettingsIcon className="size-4" />
            Settings
          </SheetTitle>
          <SheetDescription className="sr-only">
            Manage appearance, library location, and imports.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-6 pt-2 pb-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              Appearance
            </h2>
            <ToggleGroup
              variant="outline"
              value={[theme ?? 'system']}
              onValueChange={(value) => {
                if (value.length > 0) {
                  setTheme(value[value.length - 1])
                }
              }}
            >
              {THEME_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              Layout
            </h2>
            <ToggleGroup
              variant="outline"
              value={[viewMode]}
              onValueChange={(value) => {
                const next = value[value.length - 1]
                if (next === 'grid' || next === 'list') {
                  onViewModeChange(next)
                }
              }}
            >
              <ToggleGroupItem value="grid">
                <LayoutGridIcon />
                Grid
              </ToggleGroupItem>
              <ToggleGroupItem value="list">
                <ListIcon />
                List
              </ToggleGroupItem>
            </ToggleGroup>

            {viewMode === 'grid' && (
              <ToggleGroup
                variant="outline"
                value={[gridSize]}
                onValueChange={(value) => {
                  const next = value[value.length - 1]
                  if (
                    next === 'small' ||
                    next === 'medium' ||
                    next === 'large'
                  ) {
                    onGridSizeChange(next)
                  }
                }}
              >
                {GRID_SIZE_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              Sort
            </h2>
            <ToggleGroup
              variant="outline"
              value={[sortMode]}
              onValueChange={(value) => {
                const next = value[value.length - 1]
                if (
                  next === 'author' ||
                  next === 'title' ||
                  next === 'recent' ||
                  next === 'year'
                ) {
                  onSortModeChange(next)
                }
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              Library
            </h2>
            <p className="break-all text-sm" title={libraryPath ?? undefined}>
              {libraryPath ?? 'No library selected'}
            </p>
            <Button variant="outline" onClick={onChooseLibrary}>
              <FolderOpenIcon data-icon="inline-start" />
              Change library folder...
            </Button>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              Import
            </h2>
            <Button variant="outline" onClick={onImportFromCalibre}>
              <BookOpenIcon data-icon="inline-start" />
              Import from Calibre...
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
