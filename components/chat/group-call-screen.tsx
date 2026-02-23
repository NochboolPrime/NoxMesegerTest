'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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
  Maximize2,
  Minimize2,
  X,
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
  streamVersion: number
  localStream: MutableRefObject<MediaStream | null>
  localVideoRef: RefObject<HTMLVideoElement | null>
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onLeaveCall: () => void
}

function ParticipantTile({
  peer,
  streamVersion,
  onExpand,
}: {
  peer: PeerInfo
  streamVersion: number
  onExpand: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [hasVideo, setHasVideo] = useState(false)

  // Attach stream and check for video tracks
  useEffect(() => {
    const stream = peer.stream
    if (!stream) {
      setHasVideo(false)
      if (videoRef.current) videoRef.current.srcObject = null
      if (audioRef.current) audioRef.current.srcObject = null
      return
    }

    if (audioRef.current) {
      audioRef.current.srcObject = stream
    }

    const checkVideo = () => {
      const videoTracks = stream.getVideoTracks()
      const activeVideo = videoTracks.some((t) => t.enabled && t.readyState === 'live')
      setHasVideo(activeVideo)

      if (videoRef.current) {
        if (activeVideo) {
          // Always re-assign srcObject to force the video element to pick up new tracks
          videoRef.current.srcObject = stream
        } else {
          videoRef.current.srcObject = null
        }
      }
    }

    checkVideo()

    // Listen for track changes on the stream itself
    stream.addEventListener('addtrack', checkVideo)
    stream.addEventListener('removetrack', checkVideo)

    // Listen for track state changes on all current video tracks
    const videoTracks = stream.getVideoTracks()
    videoTracks.forEach((t) => {
      t.addEventListener('unmute', checkVideo)
      t.addEventListener('ended', checkVideo)
      t.addEventListener('mute', checkVideo)
    })

    return () => {
      stream.removeEventListener('addtrack', checkVideo)
      stream.removeEventListener('removetrack', checkVideo)
      videoTracks.forEach((t) => {
        t.removeEventListener('unmute', checkVideo)
        t.removeEventListener('ended', checkVideo)
        t.removeEventListener('mute', checkVideo)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer.stream, streamVersion])

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <div className="relative flex items-center justify-center rounded-xl bg-secondary overflow-hidden aspect-video group/tile">
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

      {/* Hidden audio element */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Expand button (visible on hover) */}
      {hasVideo && (
        <button
          onClick={onExpand}
          className="absolute top-2 right-2 rounded-md bg-background/60 p-1.5 backdrop-blur-sm opacity-0 group-hover/tile:opacity-100 transition-opacity hover:bg-background/80"
          aria-label="View fullscreen"
        >
          <Maximize2 className="h-4 w-4 text-foreground" />
        </button>
      )}

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

// Fullscreen overlay for viewing a participant's video/screen share
function FullscreenVideoOverlay({
  peer,
  streamVersion,
  onClose,
}: {
  peer: PeerInfo | { userId: 'self'; profile: null; stream: MediaStream | null; isMuted: boolean; isCameraOff: boolean; isScreenSharing: boolean }
  streamVersion: number
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream
    }
  }, [peer.stream, streamVersion])

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const displayName = peer.userId === 'self' ? 'You' : ((peer as PeerInfo).profile?.display_name || 'User')

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95">
      {/* Close bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-white font-medium">{displayName}</span>
        <Button
          onClick={onClose}
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-white hover:text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Close fullscreen</span>
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {peer.stream && peer.stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live') ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={peer.userId === 'self'}
            className="max-h-full max-w-full rounded-xl object-contain"
            style={{ transform: peer.userId === 'self' && !peer.isScreenSharing ? 'scaleX(-1)' : 'none' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-24 w-24">
              {peer.userId !== 'self' && (
                <AvatarImage src={(peer as PeerInfo).profile?.avatar_url || undefined} />
              )}
              <AvatarFallback className="bg-primary/20 text-primary text-3xl">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="text-lg text-white font-medium">{displayName}</span>
            <span className="text-sm text-white/60">No video</span>
          </div>
        )}
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
  streamVersion,
  localStream,
  localVideoRef,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onLeaveCall,
}: GroupCallScreenProps) {
  const [fullscreenPeerId, setFullscreenPeerId] = useState<string | null>(null)

  // Re-attach local stream whenever it changes
  useEffect(() => {
    const local = localStream.current
    if (localVideoRef.current) {
      if (local && (!isCameraOff || isScreenSharing)) {
        localVideoRef.current.srcObject = isScreenSharing
          ? local // screen share is set directly on the ref's srcObject in the hook
          : new MediaStream(local.getTracks())
      } else {
        localVideoRef.current.srcObject = null
      }
    }
  }, [callState, isCameraOff, isScreenSharing, localStream, localVideoRef, streamVersion])

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const peerArray = Array.from(peers.values())
  const totalParticipants = peerArray.length + 1

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

  // Build fullscreen overlay data
  const getFullscreenPeer = useCallback(() => {
    if (!fullscreenPeerId) return null
    if (fullscreenPeerId === 'self') {
      return {
        userId: 'self' as const,
        profile: null,
        stream: localStream.current,
        isMuted,
        isCameraOff,
        isScreenSharing,
      }
    }
    return peers.get(fullscreenPeerId) || null
  }, [fullscreenPeerId, peers, localStream, isMuted, isCameraOff, isScreenSharing])

  const fullscreenPeer = getFullscreenPeer()

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Fullscreen overlay */}
      {fullscreenPeer && (
        <FullscreenVideoOverlay
          peer={fullscreenPeer}
          streamVersion={streamVersion}
          onClose={() => setFullscreenPeerId(null)}
        />
      )}

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
          <div className="relative flex items-center justify-center rounded-xl bg-secondary overflow-hidden aspect-video group/tile">
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

            {/* Expand button for self */}
            {hasLocalVideo && (
              <button
                onClick={() => setFullscreenPeerId('self')}
                className="absolute top-2 right-2 rounded-md bg-background/60 p-1.5 backdrop-blur-sm opacity-0 group-hover/tile:opacity-100 transition-opacity hover:bg-background/80"
                aria-label="View fullscreen"
              >
                <Maximize2 className="h-4 w-4 text-foreground" />
              </button>
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
            <ParticipantTile
              key={peer.userId}
              peer={peer}
              streamVersion={streamVersion}
              onExpand={() => setFullscreenPeerId(peer.userId)}
            />
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
