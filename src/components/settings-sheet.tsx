import { useTheme } from 'next-themes'
import { BookOpenIcon, FolderOpenIcon, SettingsIcon } from 'lucide-react'

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

export function SettingsSheet({
  open,
  onOpenChange,
  libraryPath,
  onChooseLibrary,
  onImportFromCalibre,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  libraryPath: string | null
  onChooseLibrary: () => void
  onImportFromCalibre: () => void
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
