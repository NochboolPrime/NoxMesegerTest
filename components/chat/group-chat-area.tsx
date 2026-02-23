'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Message, Profile, GroupCall } from '@/lib/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MessageInput } from '@/components/chat/message-input'
import { MessageBubble } from '@/components/chat/message-bubble'
import { Button } from '@/components/ui/button'
import { Phone, Video, Users, UserPlus, X, Search, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface GroupChatAreaProps {
  conversationId: string
  onStartGroupCall?: (type: 'audio' | 'video') => void
  onJoinGroupCall?: (call: GroupCall) => void
  isInCall?: boolean
}

export function GroupChatArea({
  conversationId,
  onStartGroupCall,
  onJoinGroupCall,
  isInCall,
}: GroupChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [groupName, setGroupName] = useState<string>('')
  const [memberCount, setMemberCount] = useState(0)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [activeGroupCall, setActiveGroupCall] = useState<GroupCall | null>(null)
  const [activeCallParticipantCount, setActiveCallParticipantCount] = useState(0)
  const [showMembers, setShowMembers] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [addMemberQuery, setAddMemberQuery] = useState('')
  const [addMemberResults, setAddMemberResults] = useState<Profile[]>([])
  const [isSearchingMember, setIsSearchingMember] = useState(false)
  const [isAddingMember, setIsAddingMember] = useState<string | null>(null)
  // Cache sender profiles to avoid re-fetching
  const [senderProfiles, setSenderProfiles] = useState<Record<string, Profile>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load sender profile for a message
  const loadSenderProfile = useCallback(async (senderId: string) => {
    if (senderProfiles[senderId]) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', senderId)
      .single()
    if (data) {
      setSenderProfiles((prev) => ({ ...prev, [senderId]: data }))
    }
  }, [supabase, senderProfiles])

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (data) {
      setMessages(data)
      // Load profiles for all unique senders
      const uniqueSenders = [...new Set(data.map((m) => m.sender_id))]
      uniqueSenders.forEach((id) => loadSenderProfile(id))
    }
  }, [supabase, conversationId, loadSenderProfile])

  const loadGroupInfo = useCallback(async () => {
    const { data: convo } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    if (convo) {
      setGroupName(convo.name || 'Group')
    }

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)

    if (participants) {
      setMemberCount(participants.length)
      const ids = participants.map((p: { user_id: string }) => p.user_id)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', ids)
      if (profiles) setMembers(profiles)
    }
  }, [supabase, conversationId])

  const loadActiveGroupCall = useCallback(async () => {
    const { data } = await supabase
      .from('group_calls')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)

    if (data && data.length > 0) {
      setActiveGroupCall(data[0])
      // Get participant count
      const { data: participants } = await supabase
        .from('group_call_participants')
        .select('id')
        .eq('call_id', data[0].id)
        .is('left_at', null)
      setActiveCallParticipantCount(participants?.length || 0)
    } else {
      setActiveGroupCall(null)
      setActiveCallParticipantCount(0)
    }
  }, [supabase, conversationId])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setCurrentUserId(user.id)
      await Promise.all([loadMessages(), loadGroupInfo(), loadActiveGroupCall()])
    }
    init()
  }, [conversationId, supabase, loadMessages, loadGroupInfo, loadActiveGroupCall])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Realtime subscription for messages
  useEffect(() => {
    const channel = supabase
      .channel(`group-messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev
            return [...prev, newMsg]
          })
          loadSenderProfile(newMsg.sender_id)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const deletedId = payload.old.id
          setMessages((prev) => prev.filter((m) => m.id !== deletedId))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updatedMsg = payload.new as Message
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, supabase, loadSenderProfile])

  // Realtime subscription for group calls
  useEffect(() => {
    const channel = supabase
      .channel(`group-calls:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_calls',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          loadActiveGroupCall()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_call_participants',
        },
        () => {
          loadActiveGroupCall()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, supabase, loadActiveGroupCall])

  const handleSendMessage = async (content: string, mediaUrl?: string, mediaType?: string) => {
    if (!currentUserId) return

    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: currentUserId,
      content: content || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticMsg])

    const { data, error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content: content || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
    }).select().single()

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
      return
    }

    if (data) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticMsg.id ? data : m))
      )
    }

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  const handleSearchMember = async () => {
    if (!addMemberQuery.trim()) return
    setIsSearchingMember(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const term = addMemberQuery.startsWith('@') ? addMemberQuery.slice(1) : addMemberQuery
    const memberIds = members.map((m) => m.id)

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', user.id)
      .or(`tag.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(20)

    const filtered = (data || []).filter((u) => !memberIds.includes(u.id))
    setAddMemberResults(filtered)
    setIsSearchingMember(false)
  }

  const handleAddMember = async (userId: string) => {
    setIsAddingMember(userId)
    try {
      await supabase
        .from('conversation_participants')
        .insert({
          conversation_id: conversationId,
          user_id: userId,
          role: 'member',
        })
      await loadGroupInfo()
      setAddMemberResults((prev) => prev.filter((u) => u.id !== userId))
    } catch (err) {
      console.error('Failed to add member:', err)
    } finally {
      setIsAddingMember(null)
    }
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  // Group messages by date
  const groupedMessages: { date: string; messages: Message[] }[] = []
  let currentDate = ''

  messages.forEach((msg) => {
    const msgDate = new Date(msg.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    if (msgDate !== currentDate) {
      currentDate = msgDate
      groupedMessages.push({ date: msgDate, messages: [msg] })
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg)
    }
  })

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 shrink-0">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground text-sm">{groupName}</h2>
          <p className="text-xs text-muted-foreground">
            {memberCount} members
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => { setShowMembers(!showMembers); setShowAddMember(false) }}
          >
            <Users className="h-4 w-4" />
            <span className="sr-only">Members</span>
          </Button>
          {onStartGroupCall && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => onStartGroupCall('audio')}
                disabled={isInCall}
              >
                <Phone className="h-4 w-4" />
                <span className="sr-only">Audio call</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={() => onStartGroupCall('video')}
                disabled={isInCall}
              >
                <Video className="h-4 w-4" />
                <span className="sr-only">Video call</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Active call banner */}
      {activeGroupCall && !isInCall && (
        <div className="flex items-center justify-between bg-primary/10 border-b border-primary/20 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-foreground">
              Active call
            </span>
            <span className="text-xs text-muted-foreground">
              {activeCallParticipantCount} participant{activeCallParticipantCount !== 1 ? 's' : ''}
            </span>
          </div>
          <Button
            size="sm"
            className="h-7 bg-green-600 hover:bg-green-700 text-foreground"
            onClick={() => onJoinGroupCall?.(activeGroupCall)}
          >
            Join
          </Button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Messages area */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            {groupedMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground text-sm">No messages yet. Say hello!</p>
              </div>
            ) : (
              groupedMessages.map((group) => (
                <div key={group.date}>
                  <div className="my-4 flex items-center justify-center">
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                      {group.date}
                    </span>
                  </div>
                  {group.messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isOwn={message.sender_id === currentUserId}
                      isGroup={true}
                      senderProfile={senderProfiles[message.sender_id] || null}
                    />
                  ))}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <MessageInput
            conversationId={conversationId}
            onSend={handleSendMessage}
          />
        </div>

        {/* Members panel */}
        {showMembers && (
          <div className="w-64 border-l border-border bg-card overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Members ({memberCount})</h3>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAddMember(!showAddMember)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowMembers(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Add member search */}
            {showAddMember && (
              <div className="p-2 border-b border-border">
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={addMemberQuery}
                      onChange={(e) => setAddMemberQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSearchMember() }}
                      className="pl-7 h-7 text-xs bg-secondary border-0"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={handleSearchMember}
                    disabled={isSearchingMember}
                  >
                    {isSearchingMember ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Find'}
                  </Button>
                </div>
                {addMemberResults.length > 0 && (
                  <div className="mt-1 max-h-32 overflow-y-auto">
                    {addMemberResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleAddMember(user.id)}
                        disabled={isAddingMember === user.id}
                        className="flex w-full items-center gap-2 px-1 py-1.5 rounded text-left hover:bg-secondary/50 transition-colors"
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-[9px]">
                            {getInitials(user.display_name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-foreground truncate flex-1">
                          {user.display_name}
                        </span>
                        {isAddingMember === user.id && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Member list */}
            <div className="p-1">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2 px-2 py-2 rounded hover:bg-secondary/50 transition-colors"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {getInitials(member.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm text-foreground truncate">
                      {member.display_name || 'User'}
                      {member.id === currentUserId && (
                        <span className="text-xs text-muted-foreground ml-1">(you)</span>
                      )}
                    </p>
                    {member.tag && (
                      <p className="text-[11px] text-muted-foreground">@{member.tag}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
