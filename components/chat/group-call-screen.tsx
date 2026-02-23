'use client'

import { useEffect, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Mic,
  MicOff,
  VideoIcon,
  VideoOff,
  PhoneOff,
  Monitor,
  MonitorOff,
  Users,
} from 'lucide-react'
import type { GroupCallState, PeerInfo } from '@/hooks/use-group-webrtc'
import type { RefObject, MutableRefObject } from 'react'

interface GroupCallScreenProps {
  callState: GroupCallState
  callType: 'audio' | 'video'
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
  peers: Map<string, PeerInfo>
  callDuration: number
  localStream: MutableRefObject<MediaStream | null>
  localVideoRef: RefObject<HTMLVideoElement | null>
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onLeaveCall: () => void
}

function ParticipantTile({ peer }: { peer: PeerInfo }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (peer.stream) {
      if (videoRef.current) {
        videoRef.current.srcObject = peer.stream
      }
      if (audioRef.current) {
        audioRef.current.srcObject = peer.stream
      }
    }
  }, [peer.stream])

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const hasVideo = peer.stream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live')

  return (
    <div className="relative flex items-center justify-center rounded-xl bg-secondary overflow-hidden aspect-video">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Avatar className="h-16 w-16">
            <AvatarImage src={peer.profile?.avatar_url || undefined} />
            <AvatarFallback className="bg-primary/20 text-primary text-xl">
              {getInitials(peer.profile?.display_name || null)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-foreground font-medium">
            {peer.profile?.display_name || 'User'}
          </span>
        </div>
      )}

      {/* Audio element (hidden) */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Name overlay */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 backdrop-blur-sm">
          <span className="text-xs text-foreground font-medium truncate max-w-24">
            {peer.profile?.display_name || 'User'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {peer.isMuted && (
            <div className="rounded-full bg-destructive/80 p-1">
              <MicOff className="h-3 w-3 text-destructive-foreground" />
            </div>
          )}
          {peer.isScreenSharing && (
            <div className="rounded-full bg-primary/80 p-1">
              <Monitor className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function GroupCallScreen({
  callState,
  isMuted,
  isCameraOff,
  isScreenSharing,
  peers,
  callDuration,
  localStream,
  localVideoRef,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onLeaveCall,
}: GroupCallScreenProps) {
  // Re-attach local stream
  useEffect(() => {
    const local = localStream.current
    if (local && localVideoRef.current) {
      localVideoRef.current.srcObject = local
    }
  }, [callState, isCameraOff, isScreenSharing, localStream, localVideoRef])

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const peerArray = Array.from(peers.values())
  const totalParticipants = peerArray.length + 1 // +1 for self

  // Determine grid layout
  const getGridClass = () => {
    if (totalParticipants <= 1) return 'grid-cols-1'
    if (totalParticipants === 2) return 'grid-cols-2'
    if (totalParticipants <= 4) return 'grid-cols-2'
    return 'grid-cols-3'
  }

  const statusText = () => {
    switch (callState) {
      case 'joining':
        return 'Joining...'
      case 'active':
        return formatDuration(callDuration)
      case 'ended':
        return 'Call ended'
      default:
        return ''
    }
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const hasLocalVideo = !isCameraOff || isScreenSharing

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-foreground">
            <Users className="h-4 w-4" />
            <span className="text-sm font-medium">Group Call</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {callState === 'active' && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-muted-foreground">{statusText()}</span>
            </div>
          )}
          {callState === 'joining' && (
            <span className="text-sm text-muted-foreground">{statusText()}</span>
          )}
        </div>
      </div>

      {/* Participants grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className={`grid ${getGridClass()} gap-3 h-full auto-rows-fr`}>
          {/* Self tile */}
          <div className="relative flex items-center justify-center rounded-xl bg-secondary overflow-hidden aspect-video">
            {hasLocalVideo ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
                style={{ transform: isScreenSharing ? 'none' : 'scaleX(-1)' }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="bg-primary/20 text-primary text-xl">
                    {getInitials('You')}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-foreground font-medium">You</span>
              </div>
            )}

            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 backdrop-blur-sm">
                <span className="text-xs text-foreground font-medium">You</span>
              </div>
              <div className="flex items-center gap-1">
                {isMuted && (
                  <div className="rounded-full bg-destructive/80 p-1">
                    <MicOff className="h-3 w-3 text-destructive-foreground" />
                  </div>
                )}
                {isScreenSharing && (
                  <div className="rounded-full bg-primary/80 p-1">
                    <Monitor className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Remote participant tiles */}
          {peerArray.map((peer) => (
            <ParticipantTile key={peer.userId} peer={peer} />
          ))}

          {/* Empty state when alone */}
          {peerArray.length === 0 && callState === 'active' && (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-border">
              <div className="text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">Waiting for others to join...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 bg-card/80 p-6 backdrop-blur-sm border-t border-border">
        {/* Mute */}
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

        {/* Camera */}
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
          {isCameraOff ? <VideoOff className="h-5 w-5" /> : <VideoIcon className="h-5 w-5" />}
          <span className="sr-only">{isCameraOff ? 'Turn on camera' : 'Turn off camera'}</span>
        </Button>

        {/* Screen share */}
        {callState === 'active' && (
          <Button
            onClick={onToggleScreenShare}
            variant="outline"
            size="lg"
            className={`h-14 w-14 rounded-full ${
              isScreenSharing
                ? 'bg-primary/20 border-primary text-primary hover:bg-primary/30 hover:text-primary'
                : 'bg-secondary border-border text-foreground hover:bg-secondary/80'
            }`}
          >
            {isScreenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
            <span className="sr-only">{isScreenSharing ? 'Stop sharing' : 'Share screen'}</span>
          </Button>
        )}

        {/* Leave call */}
        <Button
          onClick={onLeaveCall}
          size="lg"
          className="h-14 w-14 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg"
        >
          <PhoneOff className="h-5 w-5" />
          <span className="sr-only">Leave call</span>
        </Button>
      </div>
    </div>
  )
}
