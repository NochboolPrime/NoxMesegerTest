'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, X, Loader2, Users } from 'lucide-react'

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGroupCreated: (conversationId: string) => void
}

export function CreateGroupDialog({ open, onOpenChange, onGroupCreated }: CreateGroupDialogProps) {
  const [groupName, setGroupName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const supabase = createClient()

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const term = searchQuery.startsWith('@') ? searchQuery.slice(1) : searchQuery

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', user.id)
      .or(`tag.ilike.%${term}%,display_name.ilike.%${term}%`)
      .limit(20)

    const filtered = (data || []).filter(
      (u) => !selectedUsers.some((s) => s.id === u.id)
    )
    setSearchResults(filtered)
    setIsSearching(false)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const addUser = (user: Profile) => {
    setSelectedUsers((prev) => [...prev, user])
    setSearchResults((prev) => prev.filter((u) => u.id !== user.id))
  }

  const removeUser = (userId: string) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId))
  }

  const handleCreate = async () => {
    if (!groupName.trim() || selectedUsers.length < 1) return
    setIsCreating(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Create conversation with group metadata
      const { data: convo, error: convoError } = await supabase
        .from('conversations')
        .insert({
          is_group: true,
          name: groupName.trim(),
          created_by: user.id,
        })
        .select()
        .single()

      if (convoError || !convo) throw convoError

      // Add current user as admin
      await supabase
        .from('conversation_participants')
        .insert({
          conversation_id: convo.id,
          user_id: user.id,
          role: 'admin',
        })

      // Add selected users as members
      for (const u of selectedUsers) {
        await supabase
          .from('conversation_participants')
          .insert({
            conversation_id: convo.id,
            user_id: u.id,
            role: 'member',
          })
      }

      // Send a system-style first message
      await supabase.from('messages').insert({
        conversation_id: convo.id,
        sender_id: user.id,
        content: `Group "${groupName.trim()}" created`,
      })

      onGroupCreated(convo.id)
      resetState()
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to create group:', err)
    } finally {
      setIsCreating(false)
    }
  }

  const resetState = () => {
    setGroupName('')
    setSearchQuery('')
    setSearchResults([])
    setSelectedUsers([])
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState() }}>
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Users className="h-5 w-5" />
            Create Group Chat
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Group name */}
          <div>
            <label htmlFor="group-name" className="text-sm font-medium text-foreground mb-1.5 block">
              Group Name
            </label>
            <Input
              id="group-name"
              placeholder="Enter group name..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="bg-secondary border-0 text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Selected users */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-1"
                >
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/30 text-primary text-[10px]">
                      {getInitials(user.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-foreground">{user.display_name}</span>
                  <button
                    onClick={() => removeUser(user.id)}
                    className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Search users */}
          <div>
            <label htmlFor="search-users" className="text-sm font-medium text-foreground mb-1.5 block">
              Add Members
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-users"
                  placeholder="Search by @tag or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="pl-9 bg-secondary border-0 text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <Button
                size="sm"
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
              </Button>
            </div>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-secondary/50 scrollbar-thin">
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => addUser(user)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary transition-colors"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {getInitials(user.display_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium text-foreground truncate">
                      {user.display_name || 'User'}
                    </p>
                    {user.tag && (
                      <p className="text-xs text-muted-foreground">@{user.tag}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { onOpenChange(false); resetState() }}
            className="border-border text-foreground hover:bg-secondary"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !groupName.trim() || selectedUsers.length < 1}
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Create Group ({selectedUsers.length + 1} members)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
