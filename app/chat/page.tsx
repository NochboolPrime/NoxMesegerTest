'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatSidebar } from '@/components/chat/chat-sidebar'
import { ChatArea } from '@/components/chat/chat-area'
import { GroupChatArea } from '@/components/chat/group-chat-area'
import { ProfilePanel } from '@/components/chat/profile-panel'
import { SearchUsersPanel } from '@/components/chat/search-users-panel'
import { IncomingCallOverlay } from '@/components/chat/incoming-call-overlay'
import { ActiveCallScreen } from '@/components/chat/active-call-screen'
import { GroupCallScreen } from '@/components/chat/group-call-screen'
import { useWebRTC } from '@/hooks/use-webrtc'
import { useGroupWebRTC } from '@/hooks/use-group-webrtc'
import type { Profile, GroupCall } from '@/lib/types'

export default function ChatPage() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [otherUserId, setOtherUserId] = useState<string | null>(null)
  const [isGroupConversation, setIsGroupConversation] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [sidebarKey, setSidebarKey] = useState(0)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [remoteUserProfile, setRemoteUserProfile] = useState<Profile | null>(null)

  const supabase = createClient()

  // 1:1 WebRTC
  const webrtc = useWebRTC({
    currentUserId,
    conversationId: activeConversationId,
  })

  // Group WebRTC
  const groupWebrtc = useGroupWebRTC({
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

  // Load remote user profile when 1:1 call comes in
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

  // Select 1:1 conversation
  const handleSelectConversation = (conversationId: string, userId: string) => {
    setActiveConversationId(conversationId)
    setOtherUserId(userId)
    setIsGroupConversation(false)
    setShowProfile(false)
    setShowSearch(false)
  }

  // Select group conversation
  const handleSelectGroupConversation = (conversationId: string) => {
    setActiveConversationId(conversationId)
    setOtherUserId(null)
    setIsGroupConversation(true)
    setShowProfile(false)
    setShowSearch(false)
  }

  const handleStartConversation = (conversationId: string, userId: string) => {
    setActiveConversationId(conversationId)
    setOtherUserId(userId)
    setIsGroupConversation(false)
    setShowSearch(false)
    setSidebarKey((prev) => prev + 1)
  }

  // 1:1 call
  const handleStartCall = (type: 'audio' | 'video') => {
    if (otherUserId) {
      webrtc.startCall(otherUserId, type)
    }
  }

  // Group call - start new
  const handleStartGroupCall = (type: 'audio' | 'video') => {
    groupWebrtc.startGroupCall(type)
  }

  // Group call - join existing
  const handleJoinGroupCall = (call: GroupCall) => {
    groupWebrtc.joinGroupCall(call)
  }

  // Update document title
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        document.title = 'Messenger'
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const isInAnyCall = webrtc.callState !== 'idle' || groupWebrtc.groupCallState !== 'idle'

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <ChatSidebar
        key={sidebarKey}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onSelectGroupConversation={handleSelectGroupConversation}
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
      ) : activeConversationId && isGroupConversation ? (
        <GroupChatArea
          key={activeConversationId}
          conversationId={activeConversationId}
          onStartGroupCall={handleStartGroupCall}
          onJoinGroupCall={handleJoinGroupCall}
          isInCall={isInAnyCall}
        />
      ) : activeConversationId && otherUserId ? (
        <ChatArea
          key={activeConversationId}
          conversationId={activeConversationId}
          otherUserId={otherUserId}
          onStartCall={handleStartCall}
          isInCall={isInAnyCall}
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

      {/* Incoming 1:1 call overlay */}
      {webrtc.callState === 'ringing' && (
        <IncomingCallOverlay
          caller={remoteUserProfile}
          callType={webrtc.callType}
          onAnswer={webrtc.answerCall}
          onDecline={webrtc.declineCall}
        />
      )}

      {/* Active 1:1 call screen */}
      {(webrtc.callState === 'calling' || webrtc.callState === 'active' || webrtc.callState === 'ended') && (
        <ActiveCallScreen
          callState={webrtc.callState}
          callType={webrtc.callType}
          remoteUser={remoteUserProfile}
          isMuted={webrtc.isMuted}
          isCameraOff={webrtc.isCameraOff}
          isScreenSharing={webrtc.isScreenSharing}
          hasVideo={webrtc.hasVideo}
          callDuration={webrtc.callDuration}
          localVideoRef={webrtc.localVideoRef}
          remoteVideoRef={webrtc.remoteVideoRef}
          remoteAudioRef={webrtc.remoteAudioRef}
          remoteStream={webrtc.remoteStream}
          localStream={webrtc.localStream}
          onToggleMute={webrtc.toggleMute}
          onToggleCamera={webrtc.toggleCamera}
          onEnableCamera={webrtc.enableCamera}
          onDisableCamera={webrtc.disableCamera}
          onToggleScreenShare={webrtc.toggleScreenShare}
          onEndCall={webrtc.endCall}
        />
      )}

      {/* Active group call screen */}
      {(groupWebrtc.groupCallState === 'joining' || groupWebrtc.groupCallState === 'active') && (
        <GroupCallScreen
          callState={groupWebrtc.groupCallState}
          callType={groupWebrtc.groupCallType}
          isMuted={groupWebrtc.isMuted}
          isCameraOff={groupWebrtc.isCameraOff}
          isScreenSharing={groupWebrtc.isScreenSharing}
          peers={groupWebrtc.peers}
          callDuration={groupWebrtc.callDuration}
          streamVersion={groupWebrtc.streamVersion}
          localStream={groupWebrtc.localStream}
          localVideoRef={groupWebrtc.localVideoRef}
          onToggleMute={groupWebrtc.toggleMute}
          onToggleCamera={groupWebrtc.toggleCamera}
          onToggleScreenShare={groupWebrtc.toggleScreenShare}
          onLeaveCall={groupWebrtc.leaveGroupCall}
        />
      )}
    </div>
  )
}
