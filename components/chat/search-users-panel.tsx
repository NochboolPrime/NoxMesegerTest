'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ArrowLeft, Search, MessageCircle, Loader2 } from 'lucide-react'

interface SearchUsersPanelProps {
  onClose: () => void
  onStartConversation: (conversationId: string, userId: string) => void
}

export function SearchUsersPanel({ onClose, onStartConversation }: SearchUsersPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isCreating, setIsCreating] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const supabase = createClient()

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsSearching(true)
    setHasSearched(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Search by tag or display_name
    const searchTerm = query.startsWith('@') ? query.slice(1) : query

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', user.id)
      .or(`tag.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%`)
      .limit(20)

    setResults(data || [])
    setIsSearching(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const startChat = async (userId: string) => {
    setIsCreating(userId)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Check if conversation already exists between these two users
      const { data: myConvos } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id)

      if (myConvos && myConvos.length > 0) {
        const myConvoIds = myConvos.map((c) => c.conversation_id)

        const { data: sharedConvos } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId)
          .in('conversation_id', myConvoIds)

        if (sharedConvos && sharedConvos.length > 0) {
          // Existing conversation found
          onStartConversation(sharedConvos[0].conversation_id, userId)
          return
        }
      }

      // Create new conversation
      const { data: newConvo, error: convoError } = await supabase
        .from('conversations')
        .insert({})
        .select()
        .single()

      if (convoError || !newConvo) throw convoError

      // Add both participants
      const { error: p1Error } = await supabase
        .from('conversation_participants')
        .insert({ conversation_id: newConvo.id, user_id: user.id })

      if (p1Error) throw p1Error

      const { error: p2Error } = await supabase
        .from('conversation_participants')
        .insert({ conversation_id: newConvo.id, user_id: userId })

      if (p2Error) throw p2Error

      onStartConversation(newConvo.id, userId)
    } catch (err) {
      console.error('Failed to start conversation:', err)
    } finally {
      setIsCreating(null)
    }
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
        <h2 className="font-semibold text-foreground">Find Users</h2>
      </div>

      {/* Search */}
      <div className="p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by @tag or name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9 bg-secondary border-0 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Button onClick={handleSearch} disabled={isSearching || !query.trim()}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </Button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!hasSearched ? (
          <div className="p-6 text-center">
            <Search className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm">
              Search for users by their @tag or display name
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No users found for &quot;{query}&quot;
          </div>
        ) : (
          results.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors"
            >
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarImage src={user.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-sm">
                  {getInitials(user.display_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <p className="font-medium text-foreground text-sm truncate">
                  {user.display_name || 'User'}
                </p>
                {user.tag && (
                  <p className="text-xs text-muted-foreground">@{user.tag}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => startChat(user.id)}
                disabled={isCreating === user.id}
              >
                {isCreating === user.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <MessageCircle className="h-4 w-4 mr-1" />
                    Chat
                  </>
                )}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
