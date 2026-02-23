-- =============================================
-- Migration: Group Chats & Group Calls
-- =============================================

-- 1. Add group-related columns to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Add role column to conversation_participants
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member'));

-- 3. Create group_calls table
CREATE TABLE IF NOT EXISTS public.group_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  started_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'video' CHECK (type IN ('audio', 'video')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.group_calls ENABLE ROW LEVEL SECURITY;

-- 4. Create group_call_participants table
CREATE TABLE IF NOT EXISTS public.group_call_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.group_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  left_at timestamptz,
  is_muted boolean NOT NULL DEFAULT false,
  is_camera_off boolean NOT NULL DEFAULT true,
  is_screen_sharing boolean NOT NULL DEFAULT false,
  UNIQUE(call_id, user_id)
);

ALTER TABLE public.group_call_participants ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS Policies for group_calls
-- =============================================

-- Select: conversation participants can view group calls
DROP POLICY IF EXISTS "group_calls_select" ON public.group_calls;
CREATE POLICY "group_calls_select" ON public.group_calls
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = group_calls.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- Insert: any conversation participant can start a group call
DROP POLICY IF EXISTS "group_calls_insert" ON public.group_calls;
CREATE POLICY "group_calls_insert" ON public.group_calls
  FOR INSERT WITH CHECK (
    auth.uid() = started_by
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = group_calls.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- Update: starter can update (e.g. end the call)
DROP POLICY IF EXISTS "group_calls_update" ON public.group_calls;
CREATE POLICY "group_calls_update" ON public.group_calls
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = group_calls.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- =============================================
-- RLS Policies for group_call_participants
-- =============================================

-- Select: conversation participants can view call participants
DROP POLICY IF EXISTS "group_call_participants_select" ON public.group_call_participants;
CREATE POLICY "group_call_participants_select" ON public.group_call_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.group_calls gc
      JOIN public.conversation_participants cp ON cp.conversation_id = gc.conversation_id
      WHERE gc.id = group_call_participants.call_id
        AND cp.user_id = auth.uid()
    )
  );

-- Insert: users can join a call (add themselves)
DROP POLICY IF EXISTS "group_call_participants_insert" ON public.group_call_participants;
CREATE POLICY "group_call_participants_insert" ON public.group_call_participants
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.group_calls gc
      JOIN public.conversation_participants cp ON cp.conversation_id = gc.conversation_id
      WHERE gc.id = group_call_participants.call_id
        AND cp.user_id = auth.uid()
        AND gc.status = 'active'
    )
  );

-- Update: users can update their own participant row (mute, camera, etc.)
DROP POLICY IF EXISTS "group_call_participants_update" ON public.group_call_participants;
CREATE POLICY "group_call_participants_update" ON public.group_call_participants
  FOR UPDATE USING (auth.uid() = user_id);

-- Delete: users can remove themselves from a call
DROP POLICY IF EXISTS "group_call_participants_delete" ON public.group_call_participants;
CREATE POLICY "group_call_participants_delete" ON public.group_call_participants
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================
-- Realtime for new tables
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_call_participants;

-- =============================================
-- Update conversations RLS to support group chats
-- =============================================

-- Allow conversation participants to read conversations
DROP POLICY IF EXISTS "conversations_select_participant" ON public.conversations;
CREATE POLICY "conversations_select_participant" ON public.conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
        AND cp.user_id = auth.uid()
    )
  );

-- Allow authenticated users to create conversations
DROP POLICY IF EXISTS "conversations_insert_authenticated" ON public.conversations;
CREATE POLICY "conversations_insert_authenticated" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Allow participants to update conversations (e.g., group name)
DROP POLICY IF EXISTS "conversations_update_participant" ON public.conversations;
CREATE POLICY "conversations_update_participant" ON public.conversations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
        AND cp.user_id = auth.uid()
    )
  );

-- =============================================
-- RLS for conversation_participants (group support)
-- =============================================

-- Participants can view other participants in their conversations
DROP POLICY IF EXISTS "cp_select_participant" ON public.conversation_participants;
CREATE POLICY "cp_select_participant" ON public.conversation_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp2
      WHERE cp2.conversation_id = conversation_participants.conversation_id
        AND cp2.user_id = auth.uid()
    )
  );

-- Authenticated users can add participants (for creating conversations / adding members)
DROP POLICY IF EXISTS "cp_insert_authenticated" ON public.conversation_participants;
CREATE POLICY "cp_insert_authenticated" ON public.conversation_participants
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
