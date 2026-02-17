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

export interface Call {
  id: string
  conversation_id: string
  caller_id: string
  callee_id: string
  type: 'audio' | 'video'
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined'
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export type WebRTCSignal =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit; callId: string; callerId: string; calleeId: string; callType: 'audio' | 'video' }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit; callId: string }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit; callId: string }
  | { type: 'call-end'; callId: string }
  | { type: 'call-decline'; callId: string }
