'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, VideoIcon, VideoOff, PhoneOff } from 'lucide-react'
import type { Profile } from '@/lib/types'
import type { CallState } from '@/hooks/use-webrtc'
import type { RefObject } from 'react'

interface ActiveCallScreenProps {
  callState: CallState
  callType: 'audio' | 'video'
  remoteUser: Profile | null
  isMuted: boolean
  isCameraOff: boolean
  callDuration: number
  localVideoRef: RefObject<HTMLVideoElement | null>
  remoteVideoRef: RefObject<HTMLVideoElement | null>
  onToggleMute: () => void
  onToggleCamera: () => void
  onEndCall: () => void
}

export function ActiveCallScreen({
  callState,
  callType,
  remoteUser,
  isMuted,
  isCameraOff,
  callDuration,
  localVideoRef,
  remoteVideoRef,
  onToggleMute,
  onToggleCamera,
  onEndCall,
}: ActiveCallScreenProps) {
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const statusText = () => {
    switch (callState) {
      case 'calling':
        return 'Calling...'
      case 'active':
        return formatDuration(callDuration)
      case 'ended':
        return 'Call ended'
      default:
        return ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Main area */}
      <div className="relative flex flex-1 items-center justify-center">
        {callType === 'video' ? (
          <>
            {/* Remote video (full screen) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />

            {/* Local video (small picture-in-picture) */}
            <div className="absolute right-4 top-4 overflow-hidden rounded-xl border-2 border-border shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-40 w-28 object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              {isCameraOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                  <VideoOff className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Info overlay on video */}
            <div className="absolute left-0 right-0 top-0 bg-gradient-to-b from-background/70 to-transparent p-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-foreground">
                  {remoteUser?.display_name || 'Unknown'}
                </h3>
                <p className="text-sm text-muted-foreground">{statusText()}</p>
              </div>
            </div>
          </>
        ) : (
          /* Audio call — show avatar */
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              {callState === 'calling' && (
                <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
              )}
              {callState === 'active' && (
                <div className="absolute -inset-2 animate-pulse rounded-full bg-primary/10" />
              )}
              <Avatar className="relative h-32 w-32">
                <AvatarImage src={remoteUser?.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-4xl">
                  {getInitials(remoteUser?.display_name || null)}
                </AvatarFallback>
              </Avatar>
            </div>

            <div className="text-center">
              <h3 className="text-2xl font-semibold text-foreground">
                {remoteUser?.display_name || 'Unknown'}
              </h3>
              <p className="mt-2 text-base text-muted-foreground">{statusText()}</p>
            </div>

            {/* Hidden audio elements */}
            <audio ref={remoteVideoRef as React.RefObject<HTMLAudioElement>} autoPlay className="hidden" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 bg-card/80 p-6 backdrop-blur-sm border-t border-border">
        <Button
          onClick={onToggleMute}
          variant="outline"
          size="lg"
          className={`h-14 w-14 rounded-full ${
            isMuted
              ? 'bg-destructive/20 border-destructive text-destructive hover:bg-destructive/30 hover:text-destructive'
              : 'bg-secondary border-border text-foreground hover:bg-secondary/80'
          }`}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          <span className="sr-only">{isMuted ? 'Unmute' : 'Mute'}</span>
        </Button>

        {callType === 'video' && (
          <Button
            onClick={onToggleCamera}
            variant="outline"
            size="lg"
            className={`h-14 w-14 rounded-full ${
              isCameraOff
                ? 'bg-destructive/20 border-destructive text-destructive hover:bg-destructive/30 hover:text-destructive'
                : 'bg-secondary border-border text-foreground hover:bg-secondary/80'
            }`}
          >
            {isCameraOff ? (
              <VideoOff className="h-5 w-5" />
            ) : (
              <VideoIcon className="h-5 w-5" />
            )}
            <span className="sr-only">{isCameraOff ? 'Turn on camera' : 'Turn off camera'}</span>
          </Button>
        )}

        <Button
          onClick={onEndCall}
          size="lg"
          className="h-14 w-14 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg"
        >
          <PhoneOff className="h-5 w-5" />
          <span className="sr-only">End call</span>
        </Button>
      </div>
    </div>
  )
}
