'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Phone, PhoneOff, Video } from 'lucide-react'
import type { Profile } from '@/lib/types'

interface IncomingCallOverlayProps {
  caller: Profile | null
  callType: 'audio' | 'video'
  onAnswer: () => void
  onDecline: () => void
}

export function IncomingCallOverlay({
  caller,
  callType,
  onAnswer,
  onDecline,
}: IncomingCallOverlayProps) {
  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-card p-8 shadow-2xl border border-border">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <Avatar className="relative h-24 w-24">
            <AvatarImage src={caller?.avatar_url || undefined} />
            <AvatarFallback className="bg-primary/20 text-primary text-2xl">
              {getInitials(caller?.display_name || null)}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center">
          <h3 className="text-xl font-semibold text-foreground">
            {caller?.display_name || 'Unknown'}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {callType === 'video' ? 'Incoming video call...' : 'Incoming audio call...'}
          </p>
        </div>

        <div className="flex items-center gap-8">
          <Button
            onClick={onDecline}
            size="lg"
            className="h-16 w-16 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg"
          >
            <PhoneOff className="h-6 w-6" />
            <span className="sr-only">Decline call</span>
          </Button>

          <Button
            onClick={onAnswer}
            size="lg"
            className="h-16 w-16 rounded-full bg-green-600 hover:bg-green-700 text-foreground shadow-lg"
          >
            {callType === 'video' ? (
              <Video className="h-6 w-6" />
            ) : (
              <Phone className="h-6 w-6" />
            )}
            <span className="sr-only">Answer call</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
