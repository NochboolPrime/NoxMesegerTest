'use client'

import { useState, useEffect } from 'react'
import { ChatSidebar } from '@/components/chat/chat-sidebar'
import { ChatArea } from '@/components/chat/chat-area'
import { ProfilePanel } from '@/components/chat/profile-panel'
import { SearchUsersPanel } from '@/components/chat/search-users-panel'

export default function ChatPage() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [otherUserId, setOtherUserId] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [sidebarKey, setSidebarKey] = useState(0)

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
    </div>
  )
}
