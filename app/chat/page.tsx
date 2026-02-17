'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatSidebar } from '@/components/chat/chat-sidebar'
import { ChatArea } from '@/components/chat/chat-area'
import { ProfilePanel } from '@/components/chat/profile-panel'
import { SearchUsersPanel } from '@/components/chat/search-users-panel'
import { IncomingCallOverlay } from '@/components/chat/incoming-call-overlay'
import { ActiveCallScreen } from '@/components/chat/active-call-screen'
import { useWebRTC } from '@/hooks/use-webrtc'
import type { Profile } from '@/lib/types'

export default function ChatPage() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [otherUserId, setOtherUserId] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [sidebarKey, setSidebarKey] = useState(0)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [remoteUserProfile, setRemoteUserProfile] = useState<Profile | null>(null)

  const supabase = createClient()

  const webrtc = useWebRTC({
    currentUserId,
    conversationId: activeConversationId,
  })

  // Get current user ID
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setCurrentUserId(user.id)
    }
    getUser()
  }, [supabase])

  // Load remote user profile when call comes in
  const loadRemoteProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (data) setRemoteUserProfile(data)
  }, [supabase])

  useEffect(() => {
    if (webrtc.remoteUserId) {
      loadRemoteProfile(webrtc.remoteUserId)
    }
  }, [webrtc.remoteUserId, loadRemoteProfile])

  const handleSelectConversation = (conversationId: string, userId: string) => {
    setActiveConversationId(conversationId)
    setOtherUserId(userId)
    setShowProfile(false)
    setShowSearch(false)
  }

  const handleStartConversation = (conversationId: string, userId: string) => {
    setActiveConversationId(conversationId)
    setOtherUserId(userId)
    setShowSearch(false)
    setSidebarKey((prev) => prev + 1)
  }

  const handleStartCall = (type: 'audio' | 'video') => {
    if (otherUserId) {
      webrtc.startCall(otherUserId, type)
    }
  }

  // Update document title with unread indicator
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        document.title = 'Messenger'
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <ChatSidebar
        key={sidebarKey}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onShowProfile={() => { setShowProfile(true); setShowSearch(false) }}
        onShowSearch={() => { setShowSearch(true); setShowProfile(false) }}
      />

      {showProfile ? (
        <ProfilePanel onClose={() => setShowProfile(false)} />
      ) : showSearch ? (
        <SearchUsersPanel
          onClose={() => setShowSearch(false)}
          onStartConversation={handleStartConversation}
        />
      ) : activeConversationId && otherUserId ? (
        <ChatArea
          key={activeConversationId}
          conversationId={activeConversationId}
          otherUserId={otherUserId}
          onStartCall={handleStartCall}
          isInCall={webrtc.callState !== 'idle'}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="text-center">
            <p className="text-muted-foreground text-lg">Select a chat to start messaging</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              Or search for users by their tag
            </p>
          </div>
        </div>
      )}

      {/* Incoming call overlay */}
      {webrtc.callState === 'ringing' && (
        <IncomingCallOverlay
          caller={remoteUserProfile}
          callType={webrtc.callType}
          onAnswer={webrtc.answerCall}
          onDecline={webrtc.declineCall}
        />
      )}

      {/* Active call / Calling screen */}
      {(webrtc.callState === 'calling' || webrtc.callState === 'active' || webrtc.callState === 'ended') && (
        <ActiveCallScreen
          callState={webrtc.callState}
          callType={webrtc.callType}
          remoteUser={remoteUserProfile}
          isMuted={webrtc.isMuted}
          isCameraOff={webrtc.isCameraOff}
          callDuration={webrtc.callDuration}
          localVideoRef={webrtc.localVideoRef}
          remoteVideoRef={webrtc.remoteVideoRef}
          remoteAudioRef={webrtc.remoteAudioRef}
          remoteStream={webrtc.remoteStream}
          onToggleMute={webrtc.toggleMute}
          onToggleCamera={webrtc.toggleCamera}
          onEndCall={webrtc.endCall}
        />
      )}
    </div>
  )
}
