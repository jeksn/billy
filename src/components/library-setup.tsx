import { FolderOpenIcon, LibraryIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function LibrarySetup({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LibraryIcon className="size-5" />
            Welcome to billy
          </CardTitle>
          <CardDescription>
            billy normally keeps your books in a Billy Library folder in your
            home directory, but it could not be opened. Choose a different
            folder to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={onChoose}>
            <FolderOpenIcon data-icon="inline-start" />
            Choose library folder
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
