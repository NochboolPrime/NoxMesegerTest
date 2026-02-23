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
  const [streamVersion, setStreamVersion] = useState(0)

  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const groupCallIdRef = useRef<string | null>(null)
  const groupCallStateRef = useRef<GroupCallState>('idle')
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const videoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map())
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  // Prevent onnegotiationneeded from firing during initial setup
  const makingOfferRef = useRef<Map<string, boolean>>(new Map())
  const isScreenSharingRef = useRef(false)
  const isCameraOffRef = useRef(true)

  const supabase = createClient()

  useEffect(() => { groupCallIdRef.current = groupCallId }, [groupCallId])
  useEffect(() => { groupCallStateRef.current = groupCallState }, [groupCallState])
  useEffect(() => { isScreenSharingRef.current = isScreenSharing }, [isScreenSharing])
  useEffect(() => { isCameraOffRef.current = isCameraOff }, [isCameraOff])

  const loadPeerProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    return data
  }, [supabase])

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
    makingOfferRef.current.clear()

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

  const sendSignal = useCallback((signal: GroupWebRTCSignal) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'group-webrtc-signal',
        payload: signal,
      })
    }
  }, [])

  const getAudioStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    })
    localStreamRef.current = stream
    return stream
  }, [])

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

  // Helper: force the UI to re-render by bumping version and updating peers with SAME stream ref
  const notifyStreamUpdate = useCallback((remoteUserId: string) => {
    const stream = peerStreamsRef.current.get(remoteUserId)
    if (!stream) return
    setPeers((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(remoteUserId)
      if (existing) {
        // IMPORTANT: Use the SAME stream object (not a clone)
        // The stream contains the live receiver tracks from the PeerConnection.
        // Cloning would break the live connection between transceiver and video element.
        updated.set(remoteUserId, { ...existing, stream })
      }
      return updated
    })
    setStreamVersion((v) => v + 1)
  }, [])

  // Create peer connection
  // polite: if true, we are the "polite" peer (joiner) who yields on conflicts
  const createPeerConnectionForUser = useCallback(
    (remoteUserId: string, callId: string, isOfferer: boolean) => {
      if (peerConnectionsRef.current.has(remoteUserId)) {
        return peerConnectionsRef.current.get(remoteUserId)!
      }

      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnectionsRef.current.set(remoteUserId, pc)

      // Add ALL local tracks (audio + video if any)
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, localStreamRef.current!)
          if (track.kind === 'video') {
            videoSendersRef.current.set(remoteUserId, sender)
          }
        })
      }

      // If no video track yet, add a video transceiver so video can be added later
      // without full renegotiation (using replaceTrack)
      if (!localStreamRef.current?.getVideoTracks().length) {
        const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' })
        videoSendersRef.current.set(remoteUserId, transceiver.sender)
      }

      // If we have a screen share active, replace video sender with screen track
      if (screenStreamRef.current) {
        const screenTrack = screenStreamRef.current.getVideoTracks()[0]
        const sender = videoSendersRef.current.get(remoteUserId)
        if (sender && screenTrack) {
          console.log('[v0] Replacing video track with screen share for peer:', remoteUserId)
          sender.replaceTrack(screenTrack).then(() => {
            console.log('[v0] Screen share track replaced successfully for peer:', remoteUserId)
          }).catch((err) => {
            console.error('[v0] Failed to replace screen share track:', err)
          })
        }
      }

      // Create one stable MediaStream per peer for receiving tracks
      const remoteStream = new MediaStream()
      peerStreamsRef.current.set(remoteUserId, remoteStream)

      pc.ontrack = (event) => {
        const track = event.track
        console.log('[v0] Received track from peer:', remoteUserId, 'Kind:', track.kind, 'ID:', track.id, 'Muted:', track.muted, 'ReadyState:', track.readyState)
        const currentStream = peerStreamsRef.current.get(remoteUserId)
        if (!currentStream) return

        // Replace existing track of same kind
        currentStream.getTracks().forEach((t) => {
          if (t.kind === track.kind && t.id !== track.id) {
            console.log('[v0] Removing old track:', t.kind, t.id, 'for peer:', remoteUserId)
            currentStream.removeTrack(t)
          }
        })

        if (!currentStream.getTrackById(track.id)) {
          console.log('[v0] Adding new track to stream:', track.kind, track.id, 'for peer:', remoteUserId)
          currentStream.addTrack(track)
        }

        // When track unmutes (becomes active), notify UI
        track.onunmute = () => {
          console.log('[v0] Track unmuted:', track.kind, 'for peer:', remoteUserId)
          notifyStreamUpdate(remoteUserId)
        }
        track.onended = () => {
          console.log('[v0] Track ended:', track.kind, 'for peer:', remoteUserId)
          notifyStreamUpdate(remoteUserId)
        }
        track.onmute = () => {
          console.log('[v0] Track muted:', track.kind, 'for peer:', remoteUserId)
          notifyStreamUpdate(remoteUserId)
        }

        notifyStreamUpdate(remoteUserId)
      }

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
          makingOfferRef.current.delete(remoteUserId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.delete(remoteUserId)
            return updated
          })
        }
      }

      // Handle renegotiation (fires when addTrack/removeTrack is called)
      pc.onnegotiationneeded = async () => {
        // Allow both offerer and answerer to initiate renegotiation
        // This is needed when a joiner enables camera/screen share
        if (makingOfferRef.current.get(remoteUserId)) {
          console.log('[v0] Already making offer to peer:', remoteUserId, ', skipping negotiation')
          return
        }

        try {
          console.log('[v0] Negotiation needed for peer:', remoteUserId, 'isOfferer:', isOfferer)
          makingOfferRef.current.set(remoteUserId, true)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)

          console.log('[v0] Sending offer to peer:', remoteUserId)
          sendSignal({
            type: 'group-offer',
            sdp: pc.localDescription!,
            callId,
            fromUserId: currentUserId!,
            toUserId: remoteUserId,
          })
        } catch (err) {
          console.error('[v0] Renegotiation failed:', err)
        } finally {
          makingOfferRef.current.set(remoteUserId, false)
        }
      }

      return pc
    },
    [currentUserId, sendSignal, notifyStreamUpdate]
  )

  const handleSignal = useCallback(
    async (signal: GroupWebRTCSignal) => {
      if (!currentUserId) return
      if ('toUserId' in signal && signal.toUserId !== currentUserId) return
      if ('fromUserId' in signal && signal.fromUserId === currentUserId) return
      if ('userId' in signal && signal.userId === currentUserId) return

      const callId = signal.callId

      switch (signal.type) {
        case 'group-join': {
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

          // We are the existing participant (offerer)
          const pc = createPeerConnectionForUser(signal.userId, callId, true)
          if (!pc) return

          try {
            makingOfferRef.current.set(signal.userId, true)
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
          } finally {
            makingOfferRef.current.set(signal.userId, false)
          }
          break
        }

        case 'group-offer': {
          console.log('[v0] Received offer from peer:', signal.fromUserId)
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

          let pc = peerConnectionsRef.current.get(signal.fromUserId)

          if (pc) {
            // Existing connection - handle renegotiation
            console.log('[v0] Handling renegotiation offer from peer:', signal.fromUserId)
            
            // Implement collision detection for perfect negotiation
            const isOfferer = currentUserId! > signal.fromUserId // Stable ordering based on user ID
            const makingOffer = makingOfferRef.current.get(signal.fromUserId)
            
            // If we're in the middle of making an offer and we're the polite peer, rollback
            if (makingOffer && !isOfferer) {
              console.log('[v0] Collision detected, rolling back our offer (polite peer)')
              await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit)
              makingOfferRef.current.set(signal.fromUserId, false)
            } else if (makingOffer && isOfferer) {
              // We're the impolite peer and making an offer, ignore their offer
              console.log('[v0] Collision detected, ignoring their offer (impolite peer)')
              return
            }
            
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
              await flushPendingCandidates(signal.fromUserId)
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)

              console.log('[v0] Sending renegotiation answer to peer:', signal.fromUserId)
              sendSignal({
                type: 'group-answer',
                sdp: pc.localDescription!,
                callId,
                fromUserId: currentUserId,
                toUserId: signal.fromUserId,
              })
            } catch (err) {
              console.error('[v0] Renegotiation answer failed:', err)
            }
            break
          }

          // New connection - we are the answerer (joiner)
          console.log('[v0] Creating new peer connection for peer:', signal.fromUserId)
          pc = createPeerConnectionForUser(signal.fromUserId, callId, false)
          if (!pc) return

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
            await flushPendingCandidates(signal.fromUserId)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            console.log('[v0] Sending initial answer to peer:', signal.fromUserId)
            sendSignal({
              type: 'group-answer',
              sdp: pc.localDescription!,
              callId,
              fromUserId: currentUserId,
              toUserId: signal.fromUserId,
            })
          } catch (err) {
            console.error('[v0] Failed to handle offer from peer:', err)
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
              // ignore
            }
          } else {
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
          makingOfferRef.current.delete(signal.userId)
          setPeers((prev) => {
            const updated = new Map(prev)
            updated.delete(signal.userId)
            return updated
          })
          break
        }

        case 'group-media-state': {
          console.log('[v0] Received media state from peer:', signal.userId, 'Muted:', signal.isMuted, 'CameraOff:', signal.isCameraOff, 'ScreenSharing:', signal.isScreenSharing)
          setPeers((prev) => {
            const updated = new Map(prev)
            const existing = updated.get(signal.userId)
            if (existing) {
              console.log('[v0] Updating peer media state for:', signal.userId)
              updated.set(signal.userId, {
                ...existing,
                isMuted: signal.isMuted,
                isCameraOff: signal.isCameraOff,
                isScreenSharing: signal.isScreenSharing,
              })
            } else {
              console.log('[v0] Peer not found in state, cannot update:', signal.userId)
            }
            return updated
          })
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

  const broadcastMediaState = useCallback((newMuted: boolean, newCameraOff: boolean, newScreenSharing: boolean) => {
    if (!currentUserId || !groupCallIdRef.current) return
    console.log('[v0] Broadcasting media state - Muted:', newMuted, 'CameraOff:', newCameraOff, 'ScreenSharing:', newScreenSharing)
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
        broadcastMediaState(newMuted, isCameraOffRef.current, isScreenSharingRef.current)
      }
    }
  }, [broadcastMediaState])

  // Helper: replace video track on ALL peer connections
  const replaceVideoTrackOnAllPeers = useCallback(async (track: MediaStreamTrack | null) => {
    console.log('[v0] Replacing video track on all peers. Track:', track ? track.kind + ' - ' + track.id : 'null', 'Peer count:', videoSendersRef.current.size)
    
    const replacePromises: Promise<void>[] = []
    
    videoSendersRef.current.forEach((sender, peerId) => {
      console.log('[v0] Replacing track for peer:', peerId)
      const promise = sender.replaceTrack(track).then(() => {
        console.log('[v0] Successfully replaced track for peer:', peerId)
        
        // Force renegotiation by setting needsRenegotiation flag
        // This ensures the remote peer receives the new track
        const pc = peerConnectionsRef.current.get(peerId)
        if (pc && pc.connectionState === 'connected') {
          console.log('[v0] Triggering renegotiation for peer:', peerId)
          // Manually trigger negotiation by modifying the connection
          // The onnegotiationneeded event should fire automatically, but we'll ensure it
          setTimeout(() => {
            if (pc.onnegotiationneeded) {
              console.log('[v0] Manually calling onnegotiationneeded for peer:', peerId)
              pc.onnegotiationneeded(new Event('negotiationneeded'))
            }
          }, 100)
        }
      }).catch((err) => {
        console.error('[v0] Failed to replace track for peer:', peerId, err)
      })
      
      replacePromises.push(promise)
    })
    
    await Promise.all(replacePromises)
    console.log('[v0] All track replacements complete')
  }, [])

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (isCameraOffRef.current) {
      console.log('[v0] Enabling camera...')
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        const videoTrack = videoStream.getVideoTracks()[0]
        console.log('[v0] Got camera track:', videoTrack.id)

        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            console.log('[v0] Stopping old video track:', t.id)
            t.stop()
            localStreamRef.current?.removeTrack(t)
          })
          localStreamRef.current.addTrack(videoTrack)
          console.log('[v0] Added new camera track to local stream')
        }

        replaceVideoTrackOnAllPeers(videoTrack)

        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = new MediaStream(localStreamRef.current.getTracks())
        }

        setIsCameraOff(false)
        setStreamVersion((v) => v + 1)
        broadcastMediaState(isMuted, false, isScreenSharingRef.current)
      } catch (err) {
        console.error('[v0] Failed to enable camera:', err)
      }
    } else {
      console.log('[v0] Disabling camera...')
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          console.log('[v0] Stopping camera track:', track.id)
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
      broadcastMediaState(isMuted, true, isScreenSharingRef.current)
      console.log('[v0] Camera disabled')
    }
  }, [isMuted, replaceVideoTrackOnAllPeers, broadcastMediaState])

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharingRef.current) {
      console.log('[v0] Stopping screen share...')
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => {
          console.log('[v0] Stopping screen share track:', t.id)
          t.stop()
        })
        screenStreamRef.current = null
      }

      if (!isCameraOffRef.current) {
        console.log('[v0] Returning to camera after screen share')
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
          })
          const camTrack = camStream.getVideoTracks()[0]
          console.log('[v0] Got camera track:', camTrack.id)

          if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach((t) => {
              console.log('[v0] Removing screen track from local stream:', t.id)
              t.stop()
              localStreamRef.current?.removeTrack(t)
            })
            localStreamRef.current.addTrack(camTrack)
            console.log('[v0] Added camera track back to local stream')
          }

          replaceVideoTrackOnAllPeers(camTrack)

          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = new MediaStream(localStreamRef.current.getTracks())
          }
        } catch {
          console.log('[v0] Failed to get camera, removing video')
          replaceVideoTrackOnAllPeers(null)
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null
          }
        }
      } else {
        console.log('[v0] Camera was off, removing video track')
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            console.log('[v0] Removing screen track:', t.id)
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
      broadcastMediaState(isMuted, isCameraOffRef.current, false)
      console.log('[v0] Screen share stopped')
    } else {
      console.log('[v0] Starting screen share...')
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]
        console.log('[v0] Got screen share track:', screenTrack.id)

        replaceVideoTrackOnAllPeers(screenTrack)

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
        }

        screenTrack.onended = () => {
          console.log('[v0] Screen share track ended by user')
          screenStreamRef.current = null
          replaceVideoTrackOnAllPeers(null)

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null
          }

          setIsScreenSharing(false)
          setStreamVersion((v) => v + 1)
          broadcastMediaState(isMuted, isCameraOffRef.current, false)
        }

        setIsScreenSharing(true)
        setStreamVersion((v) => v + 1)
        broadcastMediaState(isMuted, isCameraOffRef.current, true)
        console.log('[v0] Screen share started')
      } catch (err) {
        console.log('[v0] Screen share cancelled or failed:', err)
      }
    }
  }, [isMuted, replaceVideoTrackOnAllPeers, broadcastMediaState])

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
