'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ConversationWithDetails, Message } from '@/lib/types'
import { Search, Settings, UserPlus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { formatDistanceToNow } from 'date-fns'
import { useNotificationSound } from '@/hooks/use-notification-sound'

interface ChatSidebarProps {
  activeConversationId: string | null
  onSelectConversation: (conversationId: string, userId: string) => void
  onShowProfile: () => void
  onShowSearch: () => void
}

export function ChatSidebar({
  activeConversationId,
  onSelectConversation,
  onShowProfile,
  onShowSearch,
}: ChatSidebarProps) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [search, setSearch] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const supabase = createClient()
  const { play: playNotification } = useNotificationSound()
  const activeConvoRef = useRef(activeConversationId)
  const conversationsRef = useRef(conversations)

  useEffect(() => {
    activeConvoRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const loadConversations = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setCurrentUserId(user.id)

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id)

    if (!participants || participants.length === 0) {
      setConversations([])
      return
    }

    const conversationIds = participants.map((p) => p.conversation_id)

    const { data: convos } = await supabase
      .from('conversations')
      .select('*')
      .in('id', conversationIds)
      .order('updated_at', { ascending: false })

    if (!convos) return

    const conversationsWithDetails: ConversationWithDetails[] = []

    for (const convo of convos) {
      const { data: otherParticipants } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', convo.id)
        .neq('user_id', user.id)

      if (!otherParticipants || otherParticipants.length === 0) continue

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', otherParticipants[0].user_id)
        .single()

      if (!profile) continue

      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convo.id)
        .order('created_at', { ascending: false })
        .limit(1)

      conversationsWithDetails.push({
        id: convo.id,
        updated_at: convo.updated_at,
        other_user: profile,
        last_message: messages && messages.length > 0 ? messages[0] : null,
        unread_count: 0,
      })
    }

    setConversations(conversationsWithDetails)
  }, [supabase])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Realtime: listen for new messages to update sidebar instantly
  useEffect(() => {
    if (!currentUserId) return

    const channel = supabase
      .channel('sidebar-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as Message
          const isFromMe = newMsg.sender_id === currentUserId
          const isInActiveConvo = activeConvoRef.current === newMsg.conversation_id

          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === newMsg.conversation_id)

            if (idx === -1) {
              // New conversation appeared, reload fully
              loadConversations()
              return prev
            }

            const updated = [...prev]
            const convo = { ...updated[idx] }
            convo.last_message = newMsg
            convo.updated_at = newMsg.created_at

            // Increment unread count for messages from others not in the active conversation
            if (!isFromMe && !isInActiveConvo) {
              convo.unread_count = (convo.unread_count || 0) + 1
            }

            updated[idx] = convo

            // Sort by updated_at descending
            updated.sort((a, b) =>
              new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
            )

            return updated
          })

          // Play notification sound for incoming messages not in active conversation
          if (!isFromMe && !isInActiveConvo) {
            playNotification()

            // Browser notification
            if (typeof window !== 'undefined' && Notification.permission === 'granted') {
              const convo = conversationsRef.current.find((c) => c.id === newMsg.conversation_id)
              const senderName = convo?.other_user.display_name || 'New message'
              new Notification(senderName, {
                body: newMsg.content || 'Sent a file',
                icon: convo?.other_user.avatar_url || undefined,
              })
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_participants' },
        (payload) => {
          const participant = payload.new as { user_id: string }
          if (participant.user_id === currentUserId) {
            // A new conversation was created involving me
            loadConversations()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUserId, supabase, loadConversations, playNotification])

  // Request browser notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Clear unread count when selecting a conversation
  const handleSelectConversation = (conversationId: string, userId: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, unread_count: 0 } : c
      )
    )
    onSelectConversation(conversationId, userId)
  }

  const filtered = conversations.filter((c) =>
    c.other_user.display_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.other_user.tag?.toLowerCase().includes(search.toLowerCase())
  )

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const getMessagePreview = (convo: ConversationWithDetails) => {
    if (!convo.last_message) return 'No messages yet'
    if (convo.last_message.media_url && !convo.last_message.content) {
      return convo.last_message.media_type?.startsWith('image') ? 'Photo' : 'File'
    }
    return convo.last_message.content || ''
  }

  const totalUnread = conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0)

  return (
    <div className="flex w-80 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">Chats</h1>
          {totalUnread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onShowSearch}
          >
            <UserPlus className="h-4 w-4" />
            <span className="sr-only">Find users</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onShowProfile}
          >
            <Settings className="h-4 w-4" />
            <span className="sr-only">Profile settings</span>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-0 text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {conversations.length === 0 ? 'No conversations yet. Find users to start chatting!' : 'No chats found'}
          </div>
        ) : (
          filtered.map((convo) => (
            <button
              key={convo.id}
              onClick={() => handleSelectConversation(convo.id, convo.other_user.id)}
              className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/80 ${
                activeConversationId === convo.id ? 'bg-secondary' : ''
              }`}
            >
              <div className="relative shrink-0">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={convo.other_user.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary text-sm">
                    {getInitials(convo.other_user.display_name)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className={`font-medium truncate text-sm ${convo.unread_count > 0 ? 'text-foreground' : 'text-foreground'}`}>
                    {convo.other_user.display_name || 'User'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {convo.last_message && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(convo.last_message.created_at), { addSuffix: false })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className={`text-sm truncate ${convo.unread_count > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                    {getMessagePreview(convo)}
                  </p>
                  {convo.unread_count > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground shrink-0">
                      {convo.unread_count > 99 ? '99+' : convo.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
