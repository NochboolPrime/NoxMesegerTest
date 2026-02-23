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
  // Increment to trigger re-renders in the call screen when remote tracks change
  const [streamVersion, setStreamVersion] = useState(0)

  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  // Use a single stable MediaStream per peer; we add/remove tracks on it directly
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const groupCallIdRef = useRef<string | null>(null)
  const groupCallStateRef = useRef<GroupCallState>('idle')
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  // Track the video transceiver sender per connection so we can reliably replaceTrack
  const videoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  // Pending ICE candidates for connections not yet ready
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

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

    peerConnectionsRef.current.forEach((pc) => pc.close())
    peerConnectionsRef.current.clear()
    peerStreamsRef.current.clear()
    videoSendersRef.current.clear()
    pendingCandidatesRef.current.clear()

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
    setStreamVersion(0)
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

  // Flush any pending ICE candidates for a peer
  const flushPendingCandidates = useCallback(async (remoteUserId: string) => {
    const pc = peerConnectionsRef.current.get(remoteUserId)
    const pending = pendingCandidatesRef.current.get(remoteUserId)
    if (pc && pending && pending.length > 0 && pc.remoteDescription) {
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch {
          // ignore
        }
      }
      pendingCandidatesRef.current.set(remoteUserId, [])
    }
  }, [])

  // Helper: update peer stream in state — always reads from the ref so we have a single source of truth
  const updatePeerStream = useCallback((remoteUserId: string) => {
    const stream = peerStreamsRef.current.get(remoteUserId)
    if (!stream) return

    setPeers((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(remoteUserId)
      if (existing) {
        // Clone the stream to get a new object identity so React detects the change
        const cloned = new MediaStream(stream.getTracks())
        updated.set(remoteUserId, { ...existing, stream: cloned })
      }
      return updated
    })
    setStreamVersion((v) => v + 1)
  }, [])

  // Create a peer connection for a specific remote user
  const createPeerConnectionForUser = useCallback(
    (remoteUserId: string, callId: string) => {
      if (peerConnectionsRef.current.has(remoteUserId)) {
        return peerConnectionsRef.current.get(remoteUserId)!
      }

      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnectionsRef.current.set(remoteUserId, pc)

      // Add local audio tracks
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!)
        })
      }

      // Always create a dedicated video transceiver so we have a stable sender
      // for replacing camera/screen tracks later
      const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' })
      videoSendersRef.current.set(remoteUserId, transceiver.sender)

      // If we already have a video track (camera or screen), use it
      const currentVideoTrack =
        screenStreamRef.current?.getVideoTracks()[0] ||
        localStreamRef.current?.getVideoTracks()[0] ||
        null
      if (currentVideoTrack) {
        transceiver.sender.replaceTrack(currentVideoTrack)
      }

      // Create ONE stable MediaStream per peer — we will add/remove tracks on it
      const remoteStream = new MediaStream()
      peerStreamsRef.current.set(remoteUserId, remoteStream)

      pc.ontrack = (event) => {
        const track = event.track
        // Always get the CURRENT stream from the ref (single source of truth)
        const currentStream = peerStreamsRef.current.get(remoteUserId)
        if (!currentStream) return

        // Remove any existing track of the same kind before adding new one
        currentStream.getTracks().forEach((t) => {
          if (t.kind === track.kind && t.id !== track.id) {
            currentStream.removeTrack(t)
          }
        })

        if (!currentStream.getTrackById(track.id)) {
          currentStream.addTrack(track)
        }

        // Listen for track state changes to trigger re-render
        track.onunmute = () => updatePeerStream(remoteUserId)
        track.onended = () => updatePeerStream(remoteUserId)
        track.onmute = () => updatePeerStream(remoteUserId)

        // Force UI update
        updatePeerStream(remoteUserId)
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
          peerConnectionsRef.current.delete(remoteUserId)
          peerStreamsRef.current.delete(remoteUserId)
          videoSendersRef.current.delete(remoteUserId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.delete(remoteUserId)
            return updated
          })
        }
      }

      return pc
    },
    [currentUserId, sendSignal, updatePeerStream]
  )

  // Handle incoming signal
  const handleSignal = useCallback(
    async (signal: GroupWebRTCSignal) => {
      if (!currentUserId) return

      // Ignore signals not meant for us
      if ('toUserId' in signal && signal.toUserId !== currentUserId) return
      // Ignore our own signals
      if ('fromUserId' in signal && signal.fromUserId === currentUserId) return
      if ('userId' in signal && signal.userId === currentUserId) return

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

          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            sendSignal({
              type: 'group-offer',
              sdp: pc.localDescription!,
              callId,
              fromUserId: currentUserId,
              toUserId: signal.userId,
            })
          } catch (err) {
            console.error('Failed to create offer for peer:', err)
          }
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

          // Close existing connection if any (renegotiation)
          const existingPc = peerConnectionsRef.current.get(signal.fromUserId)
          if (existingPc) {
            existingPc.close()
            peerConnectionsRef.current.delete(signal.fromUserId)
            videoSendersRef.current.delete(signal.fromUserId)
          }

          const pc = createPeerConnectionForUser(signal.fromUserId, callId)
          if (!pc) return

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
            await flushPendingCandidates(signal.fromUserId)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            sendSignal({
              type: 'group-answer',
              sdp: pc.localDescription!,
              callId,
              fromUserId: currentUserId,
              toUserId: signal.fromUserId,
            })
          } catch (err) {
            console.error('Failed to handle offer from peer:', err)
          }
          break
        }

        case 'group-answer': {
          const pc = peerConnectionsRef.current.get(signal.fromUserId)
          if (pc && pc.signalingState === 'have-local-offer') {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
              await flushPendingCandidates(signal.fromUserId)
            } catch (err) {
              console.error('Failed to set remote answer:', err)
            }
          }
          break
        }

        case 'group-ice-candidate': {
          const pc = peerConnectionsRef.current.get(signal.fromUserId)
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
            } catch {
              // ICE candidate error - ignore
            }
          } else {
            // Buffer candidate until remote description is set
            const pending = pendingCandidatesRef.current.get(signal.fromUserId) || []
            pending.push(signal.candidate)
            pendingCandidatesRef.current.set(signal.fromUserId, pending)
          }
          break
        }

        case 'group-leave': {
          const pc = peerConnectionsRef.current.get(signal.userId)
          if (pc) pc.close()
          peerConnectionsRef.current.delete(signal.userId)
          peerStreamsRef.current.delete(signal.userId)
          videoSendersRef.current.delete(signal.userId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.delete(signal.userId)
            return updated
          })
          break
        }

        case 'group-media-state': {
          // Update peer's media state (camera/mute/screen share)
          setPeers((prev) => {
            const updated = new Map(prev)
            const existing = updated.get(signal.userId)
            if (existing) {
              updated.set(signal.userId, {
                ...existing,
                isMuted: signal.isMuted,
                isCameraOff: signal.isCameraOff,
                isScreenSharing: signal.isScreenSharing,
              })
            }
            return updated
          })
          // Bump stream version so ParticipantTile re-evaluates video tracks
          // (replaceTrack on sender side doesn't fire ontrack on receiver)
          setStreamVersion((v) => v + 1)
          break
        }
      }
    },
    [currentUserId, createPeerConnectionForUser, sendSignal, loadPeerProfile, flushPendingCandidates]
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

  // Broadcast our media state to all peers
  const broadcastMediaState = useCallback((newMuted: boolean, newCameraOff: boolean, newScreenSharing: boolean) => {
    if (!currentUserId || !groupCallIdRef.current) return
    sendSignal({
      type: 'group-media-state',
      callId: groupCallIdRef.current,
      userId: currentUserId,
      isMuted: newMuted,
      isCameraOff: newCameraOff,
      isScreenSharing: newScreenSharing,
    })
  }, [currentUserId, sendSignal])

  // Start a new group call
  const startGroupCall = useCallback(
    async (type: 'audio' | 'video') => {
      if (!currentUserId || !conversationId) return

      try {
        setGroupCallType(type)
        setGroupCallState('joining')

        await getAudioStream()

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

        await supabase.from('group_call_participants').insert({
          call_id: call.id,
          user_id: currentUserId,
          is_muted: false,
          is_camera_off: true,
        })

        setGroupCallState('active')

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

        await getAudioStream()

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

    sendSignal({
      type: 'group-leave',
      callId: groupCallIdRef.current,
      userId: currentUserId,
    })

    await supabase
      .from('group_call_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('call_id', groupCallIdRef.current)
      .eq('user_id', currentUserId)

    // Check if we're the last one
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
        const newMuted = !audioTrack.enabled
        setIsMuted(newMuted)
        broadcastMediaState(newMuted, isCameraOff, isScreenSharing)
      }
    }
  }, [isCameraOff, isScreenSharing, broadcastMediaState])

  // Helper: replace video track on ALL peer connections via dedicated video sender
  const replaceVideoTrackOnAllPeers = useCallback((track: MediaStreamTrack | null) => {
    videoSendersRef.current.forEach((sender) => {
      sender.replaceTrack(track).catch(() => {
        // ignore errors on closed connections
      })
    })
  }, [])

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (isCameraOff) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        const videoTrack = videoStream.getVideoTracks()[0]

        // Store on local stream
        if (localStreamRef.current) {
          // Remove any old video tracks
          localStreamRef.current.getVideoTracks().forEach((t) => {
            t.stop()
            localStreamRef.current?.removeTrack(t)
          })
          localStreamRef.current.addTrack(videoTrack)
        }

        // Replace on all peer connections
        replaceVideoTrackOnAllPeers(videoTrack)

        // Attach to local preview
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = new MediaStream(localStreamRef.current.getTracks())
        }

        setIsCameraOff(false)
        setStreamVersion((v) => v + 1)
        broadcastMediaState(isMuted, false, isScreenSharing)
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
      }

      replaceVideoTrackOnAllPeers(null)

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null
      }
      setIsCameraOff(true)
      setStreamVersion((v) => v + 1)
      broadcastMediaState(isMuted, true, isScreenSharing)
    }
  }, [isCameraOff, isMuted, isScreenSharing, replaceVideoTrackOnAllPeers, broadcastMediaState])

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop())
        screenStreamRef.current = null
      }

      // If camera was on before, try to restore it
      if (!isCameraOff) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
          })
          const camTrack = camStream.getVideoTracks()[0]

          // Replace screen track with camera on local stream
          if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach((t) => {
              t.stop()
              localStreamRef.current?.removeTrack(t)
            })
            localStreamRef.current.addTrack(camTrack)
          }

          replaceVideoTrackOnAllPeers(camTrack)

          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = new MediaStream(localStreamRef.current.getTracks())
          }
        } catch {
          // Camera not available, go to no-video state
          replaceVideoTrackOnAllPeers(null)
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null
          }
        }
      } else {
        // Camera was off, just remove screen track
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            t.stop()
            localStreamRef.current?.removeTrack(t)
          })
        }
        replaceVideoTrackOnAllPeers(null)
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null
        }
      }

      setIsScreenSharing(false)
      setStreamVersion((v) => v + 1)
      broadcastMediaState(isMuted, isCameraOff, false)
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]

        replaceVideoTrackOnAllPeers(screenTrack)

        // Show screen share in local preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
        }

        // Handle screen share ending (user clicks browser stop)
        screenTrack.onended = () => {
          screenStreamRef.current = null
          // When browser stops screen share, camera was off or needs re-acquire
          replaceVideoTrackOnAllPeers(null)

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null
          }

          setIsScreenSharing(false)
          setStreamVersion((v) => v + 1)
          broadcastMediaState(isMuted, isCameraOff, false)
        }

        setIsScreenSharing(true)
        setStreamVersion((v) => v + 1)
        broadcastMediaState(isMuted, isCameraOff, true)
      } catch {
        // User cancelled screen share
      }
    }
  }, [isScreenSharing, isMuted, isCameraOff, replaceVideoTrackOnAllPeers, broadcastMediaState])

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
    streamVersion,
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
