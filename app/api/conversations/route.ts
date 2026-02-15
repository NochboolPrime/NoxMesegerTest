import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { otherUserId } = await request.json()

  if (!otherUserId || otherUserId === user.id) {
    return NextResponse.json({ error: 'Invalid user' }, { status: 400 })
  }

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
      .eq('user_id', otherUserId)
      .in('conversation_id', myConvoIds)

    if (sharedConvos && sharedConvos.length > 0) {
      return NextResponse.json({ conversationId: sharedConvos[0].conversation_id, existing: true })
    }
  }

  // Create new conversation
  const { data: newConvo, error: convoError } = await supabase
    .from('conversations')
    .insert({})
    .select()
    .single()

  if (convoError || !newConvo) {
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }

  // Add current user as participant (RLS allows this)
  const { error: p1Error } = await supabase
    .from('conversation_participants')
    .insert({ conversation_id: newConvo.id, user_id: user.id })

  if (p1Error) {
    return NextResponse.json({ error: 'Failed to add participant' }, { status: 500 })
  }

  // For the other user, we need to use the service role or adjust our approach.
  // Since the RLS policy requires auth.uid() = user_id, we use a database function instead.
  const { error: p2Error } = await supabase.rpc('add_conversation_participant', {
    p_conversation_id: newConvo.id,
    p_user_id: otherUserId,
  })

  if (p2Error) {
    return NextResponse.json({ error: 'Failed to add other participant' }, { status: 500 })
  }

  return NextResponse.json({ conversationId: newConvo.id, existing: false })
}
