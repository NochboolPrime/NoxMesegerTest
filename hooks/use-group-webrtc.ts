'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { GroupWebRTCSignal, GroupCall, Profile } from '@/lib/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export type GroupCallState = 'idle' | 'joining' | 'active' | 'ended'

export interface PeerInfo {
  userId: string
  profile: Profile | null
  stream: MediaStream | null
  isMuted: boolean
  isCameraOff: boolean
  isScreenSharing: boolean
}

interface UseGroupWebRTCProps {
  currentUserId: string | null
  conversationId: string | null
}

export function useGroupWebRTC({ currentUserId, conversationId }: UseGroupWebRTCProps) {
  const [groupCallState, setGroupCallState] = useState<GroupCallState>('idle')
  const [groupCallId, setGroupCallId] = useState<string | null>(null)
  const [groupCallType, setGroupCallType] = useState<'audio' | 'video'>('video')
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(true)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map())
  const [callDuration, setCallDuration] = useState(0)

  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const groupCallIdRef = useRef<string | null>(null)
  const groupCallStateRef = useRef<GroupCallState>('idle')
  const localVideoRef = useRef<HTMLVideoElement | null>(null)

  const supabase = createClient()

  // Keep refs in sync
  useEffect(() => { groupCallIdRef.current = groupCallId }, [groupCallId])
  useEffect(() => { groupCallStateRef.current = groupCallState }, [groupCallState])

  // Load profile for a peer
  const loadPeerProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    return data
  }, [supabase])

  // Cleanup everything
  const cleanupAll = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    // Close all peer connections
    peerConnectionsRef.current.forEach((pc) => pc.close())
    peerConnectionsRef.current.clear()
    peerStreamsRef.current.clear()

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }

    setPeers(new Map())
    setCallDuration(0)
    setIsMuted(false)
    setIsCameraOff(true)
    setIsScreenSharing(false)
  }, [])

  // Send signal via broadcast
  const sendSignal = useCallback((signal: GroupWebRTCSignal) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'group-webrtc-signal',
        payload: signal,
      })
    }
  }, [])

  // Get local audio stream (start with audio only)
  const getAudioStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    })
    localStreamRef.current = stream
    return stream
  }, [])

  // Create a peer connection for a specific remote user
  const createPeerConnectionForUser = useCallback(
    (remoteUserId: string, callId: string) => {
      if (peerConnectionsRef.current.has(remoteUserId)) {
        return peerConnectionsRef.current.get(remoteUserId)!
      }

      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnectionsRef.current.set(remoteUserId, pc)

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!)
        })
      }

      // Add a video transceiver for future camera/screen share
      if (!localStreamRef.current?.getVideoTracks().length) {
        pc.addTransceiver('video', { direction: 'sendrecv' })
      }

      // Handle remote tracks
      const remoteStream = new MediaStream()
      peerStreamsRef.current.set(remoteUserId, remoteStream)

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          event.streams[0].getTracks().forEach((track) => {
            if (!remoteStream.getTrackById(track.id)) {
              remoteStream.addTrack(track)
            }
          })
        } else if (event.track) {
          if (!remoteStream.getTrackById(event.track.id)) {
            remoteStream.addTrack(event.track)
          }
        }

        // Update peers state
        setPeers((prev) => {
          const updated = new Map(prev)
          const existing = updated.get(remoteUserId)
          if (existing) {
            updated.set(remoteUserId, { ...existing, stream: remoteStream })
          }
          return updated
        })
      }

      // ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && currentUserId) {
          sendSignal({
            type: 'group-ice-candidate',
            candidate: event.candidate.toJSON(),
            callId,
            fromUserId: currentUserId,
            toUserId: remoteUserId,
          })
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          // Remove peer
          peerConnectionsRef.current.delete(remoteUserId)
          peerStreamsRef.current.delete(remoteUserId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.delete(remoteUserId)
            return updated
          })
        }
      }

      return pc
    },
    [currentUserId, sendSignal]
  )

  // Handle incoming signal
  const handleSignal = useCallback(
    async (signal: GroupWebRTCSignal) => {
      if (!currentUserId) return

      // Ignore signals not meant for us
      if ('toUserId' in signal && signal.toUserId !== currentUserId) return
      // Ignore our own signals
      if (signal.fromUserId === currentUserId) return

      const callId = signal.callId

      switch (signal.type) {
        case 'group-join': {
          // Someone joined the call - create a connection and send offer
          if (groupCallStateRef.current !== 'active') return

          const profile = await loadPeerProfile(signal.userId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.set(signal.userId, {
              userId: signal.userId,
              profile,
              stream: null,
              isMuted: false,
              isCameraOff: true,
              isScreenSharing: false,
            })
            return updated
          })

          const pc = createPeerConnectionForUser(signal.userId, callId)
          if (!pc) return

          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)

          sendSignal({
            type: 'group-offer',
            sdp: pc.localDescription!,
            callId,
            fromUserId: currentUserId,
            toUserId: signal.userId,
          })
          break
        }

        case 'group-offer': {
          const profile = await loadPeerProfile(signal.fromUserId)
          setPeers((prev) => {
            const updated = new Map(prev)
            if (!updated.has(signal.fromUserId)) {
              updated.set(signal.fromUserId, {
                userId: signal.fromUserId,
                profile,
                stream: null,
                isMuted: false,
                isCameraOff: true,
                isScreenSharing: false,
              })
            }
            return updated
          })

          const pc = createPeerConnectionForUser(signal.fromUserId, callId)
          if (!pc) return

          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)

          sendSignal({
            type: 'group-answer',
            sdp: pc.localDescription!,
            callId,
            fromUserId: currentUserId,
            toUserId: signal.fromUserId,
          })
          break
        }

        case 'group-answer': {
          const pc = peerConnectionsRef.current.get(signal.fromUserId)
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
          }
          break
        }

        case 'group-ice-candidate': {
          const pc = peerConnectionsRef.current.get(signal.fromUserId)
          if (pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
            } catch {
              // ICE candidate error - ignore
            }
          }
          break
        }

        case 'group-leave': {
          const pc = peerConnectionsRef.current.get(signal.userId)
          if (pc) pc.close()
          peerConnectionsRef.current.delete(signal.userId)
          peerStreamsRef.current.delete(signal.userId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.delete(signal.userId)
            return updated
          })
          break
        }
      }
    },
    [currentUserId, createPeerConnectionForUser, sendSignal, loadPeerProfile]
  )

  // Subscribe to signaling channel
  useEffect(() => {
    if (!conversationId || !currentUserId) return

    const channel = supabase.channel(`group-call-signal:${conversationId}`, {
      config: { broadcast: { self: false } },
    })

    channel
      .on('broadcast', { event: 'group-webrtc-signal' }, (payload) => {
        const signal = payload.payload as GroupWebRTCSignal
        handleSignal(signal)
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [conversationId, currentUserId, supabase, handleSignal])

  // Start a new group call
  const startGroupCall = useCallback(
    async (type: 'audio' | 'video') => {
      if (!currentUserId || !conversationId) return

      try {
        setGroupCallType(type)
        setGroupCallState('joining')

        // Get audio stream
        await getAudioStream()

        // Create the group call record
        const { data: call, error } = await supabase
          .from('group_calls')
          .insert({
            conversation_id: conversationId,
            started_by: currentUserId,
            type,
            status: 'active',
          })
          .select()
          .single()

        if (error || !call) throw error

        setGroupCallId(call.id)

        // Add self as participant
        await supabase.from('group_call_participants').insert({
          call_id: call.id,
          user_id: currentUserId,
          is_muted: false,
          is_camera_off: true,
        })

        setGroupCallState('active')

        // Start duration timer
        durationIntervalRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1)
        }, 1000)

        // Broadcast join signal
        sendSignal({
          type: 'group-join',
          callId: call.id,
          userId: currentUserId,
        })
      } catch (err) {
        console.error('Failed to start group call:', err)
        cleanupAll()
        setGroupCallState('idle')
      }
    },
    [currentUserId, conversationId, supabase, getAudioStream, sendSignal, cleanupAll]
  )

  // Join an existing group call
  const joinGroupCall = useCallback(
    async (call: GroupCall) => {
      if (!currentUserId || !conversationId) return

      try {
        setGroupCallType(call.type)
        setGroupCallState('joining')
        setGroupCallId(call.id)

        // Get audio stream
        await getAudioStream()

        // Add self as participant
        await supabase.from('group_call_participants').upsert({
          call_id: call.id,
          user_id: currentUserId,
          is_muted: false,
          is_camera_off: true,
          left_at: null,
        }, { onConflict: 'call_id,user_id' })

        // Load existing participants
        const { data: existingParticipants } = await supabase
          .from('group_call_participants')
          .select('user_id')
          .eq('call_id', call.id)
          .is('left_at', null)
          .neq('user_id', currentUserId)

        if (existingParticipants) {
          for (const p of existingParticipants) {
            const profile = await loadPeerProfile(p.user_id)
            setPeers((prev) => {
              const updated = new Map(prev)
              updated.set(p.user_id, {
                userId: p.user_id,
                profile,
                stream: null,
                isMuted: false,
                isCameraOff: true,
                isScreenSharing: false,
              })
              return updated
            })
          }
        }

        setGroupCallState('active')

        // Start duration timer
        durationIntervalRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1)
        }, 1000)

        // Broadcast join signal - existing peers will send offers
        sendSignal({
          type: 'group-join',
          callId: call.id,
          userId: currentUserId,
        })
      } catch (err) {
        console.error('Failed to join group call:', err)
        cleanupAll()
        setGroupCallState('idle')
      }
    },
    [currentUserId, conversationId, supabase, getAudioStream, sendSignal, cleanupAll, loadPeerProfile]
  )

  // Leave the group call
  const leaveGroupCall = useCallback(async () => {
    if (!currentUserId || !groupCallIdRef.current) return

    // Broadcast leave signal
    sendSignal({
      type: 'group-leave',
      callId: groupCallIdRef.current,
      userId: currentUserId,
    })

    // Update DB
    await supabase
      .from('group_call_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('call_id', groupCallIdRef.current)
      .eq('user_id', currentUserId)

    // Check if we're the last one - if so, end the call
    const { data: remaining } = await supabase
      .from('group_call_participants')
      .select('id')
      .eq('call_id', groupCallIdRef.current)
      .is('left_at', null)

    if (!remaining || remaining.length === 0) {
      await supabase
        .from('group_calls')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', groupCallIdRef.current)
    }

    cleanupAll()
    setGroupCallState('idle')
    setGroupCallId(null)
  }, [currentUserId, supabase, sendSignal, cleanupAll])

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
      }
    }
  }, [])

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (isCameraOff) {
      // Enable camera
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        const videoTrack = videoStream.getVideoTracks()[0]

        // Add track to local stream
        if (localStreamRef.current) {
          localStreamRef.current.addTrack(videoTrack)
        }

        // Replace track on all peer connections
        peerConnectionsRef.current.forEach((pc) => {
          const senders = pc.getSenders()
          const videoSender = senders.find((s) => s.track?.kind === 'video' || (!s.track && s))
          if (videoSender) {
            videoSender.replaceTrack(videoTrack)
          } else {
            pc.addTrack(videoTrack, localStreamRef.current!)
          }
        })

        // Attach to local preview
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current
        }

        setIsCameraOff(false)
      } catch (err) {
        console.error('Failed to enable camera:', err)
      }
    } else {
      // Disable camera
      if (localStreamRef.current) {
        const videoTracks = localStreamRef.current.getVideoTracks()
        videoTracks.forEach((track) => {
          track.stop()
          localStreamRef.current?.removeTrack(track)
        })

        // Replace with null on peer connections
        peerConnectionsRef.current.forEach((pc) => {
          const senders = pc.getSenders()
          const videoSender = senders.find((s) => s.track?.kind === 'video')
          if (videoSender) {
            videoSender.replaceTrack(null)
          }
        })
      }
      setIsCameraOff(true)
    }
  }, [isCameraOff])

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop())
        screenStreamRef.current = null
      }

      // Replace with camera track or null
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null
      peerConnectionsRef.current.forEach((pc) => {
        const senders = pc.getSenders()
        const videoSender = senders.find((s) => s.track?.kind === 'video')
        if (videoSender) {
          videoSender.replaceTrack(cameraTrack)
        }
      })

      setIsScreenSharing(false)
    } else {
      // Start screen sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]

        // Replace video track on all peers
        peerConnectionsRef.current.forEach((pc) => {
          const senders = pc.getSenders()
          const videoSender = senders.find(
            (s) => s.track?.kind === 'video' || (!s.track && s)
          )
          if (videoSender) {
            videoSender.replaceTrack(screenTrack)
          }
        })

        // Handle screen share ending
        screenTrack.onended = () => {
          screenStreamRef.current = null
          const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null
          peerConnectionsRef.current.forEach((pc) => {
            const senders = pc.getSenders()
            const videoSender = senders.find((s) => s.track?.kind === 'video')
            if (videoSender) {
              videoSender.replaceTrack(cameraTrack)
            }
          })
          setIsScreenSharing(false)
        }

        setIsScreenSharing(true)
      } catch {
        // User cancelled screen share
      }
    }
  }, [isScreenSharing])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAll()
    }
  }, [cleanupAll])

  return {
    groupCallState,
    groupCallId,
    groupCallType,
    isMuted,
    isCameraOff,
    isScreenSharing,
    peers,
    callDuration,
    localStream: localStreamRef,
    localVideoRef,
    startGroupCall,
    joinGroupCall,
    leaveGroupCall,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
  }
}
