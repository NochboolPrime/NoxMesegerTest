'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ArrowLeft, Camera, LogOut, Loader2, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ProfilePanelProps {
  onClose: () => void
}

export function ProfilePanel({ onClose }: ProfilePanelProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [tag, setTag] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setProfile(data)
        setDisplayName(data.display_name || '')
        setTag(data.tag || '')
      }
    }

    loadProfile()
  }, [supabase])

  const handleSave = async () => {
    if (!profile) return
    setIsSaving(true)
    setError(null)
    setSaved(false)

    // Validate tag: only alphanumeric and underscores
    if (tag && !/^[a-zA-Z0-9_]+$/.test(tag)) {
      setError('Tag can only contain letters, numbers, and underscores')
      setIsSaving(false)
      return
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        display_name: displayName,
        tag: tag || null,
      })
      .eq('id', profile.id)

    if (updateError) {
      if (updateError.message.includes('duplicate')) {
        setError('This tag is already taken')
      } else {
        setError(updateError.message)
      }
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }

    setIsSaving(false)
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !profile) return

    if (file.size > 5 * 1024 * 1024) {
      setError('Avatar must be less than 5MB')
      return
    }

    setIsUploading(true)
    setError(null)

    try {
      const ext = file.name.split('.').pop()
      const fileName = `avatars/${profile.id}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(fileName, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('chat-media')
        .getPublicUrl(fileName)

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', profile.id)

      if (updateError) throw updateError

      setProfile({ ...profile, avatar_url: publicUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back</span>
        </Button>
        <h2 className="font-semibold text-foreground">Profile Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <div className="mx-auto max-w-md">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                  {getInitials(profile?.display_name || null)}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors"
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleAvatarUpload}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {profile?.tag ? `@${profile.tag}` : 'No tag set'}
            </p>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="displayName" className="text-foreground">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="bg-secondary border-border text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tag" className="text-foreground">
                Tag
                <span className="text-muted-foreground font-normal ml-1">(unique username for search)</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                <Input
                  id="tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder="your_tag"
                  className="bg-secondary border-border text-foreground pl-7"
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <Check className="h-4 w-4 mr-2" />
              ) : null}
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>

            <div className="mt-6 pt-6 border-t border-border">
              <Button
                variant="outline"
                className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
