import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/auth/login')
  }

  return <>{children}</>
}
