import { MessageCircle, Mail } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function SignUpSuccessPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <MessageCircle className="h-6 w-6 text-primary-foreground" />
          </div>
          <Mail className="h-12 w-12 text-muted-foreground" />
          <h1 className="text-2xl font-bold text-foreground">Check your email</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We sent you a confirmation link. Please check your email to verify your account before signing in.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/auth/login">Back to Sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
