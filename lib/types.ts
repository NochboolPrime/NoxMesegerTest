export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  tag: string | null
  created_at: string
}

export interface Conversation {
  id: string
  created_at: string
  updated_at: string
}

export interface ConversationParticipant {
  id: string
  conversation_id: string
  user_id: string
  joined_at: string
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  media_url: string | null
  media_type: string | null
  created_at: string
}

export interface ConversationWithDetails {
  id: string
  updated_at: string
  other_user: Profile
  last_message: Message | null
  unread_count: number
}
