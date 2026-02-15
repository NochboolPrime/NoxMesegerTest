import { MessageCircle, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>
}) {
  const params = await searchParams

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <MessageCircle className="h-6 w-6 text-primary-foreground" />
          </div>
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {params?.error
              ? `Error: ${params.error}`
              : 'An unspecified error occurred.'}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/auth/login">Back to Sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
