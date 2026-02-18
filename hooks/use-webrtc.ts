'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WebRTCSignal } from '@/lib/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export type CallState = 'idle' | 'calling' | 'ringing' | 'active' | 'ended'

interface UseWebRTCProps {
  currentUserId: string | null
  conversationId: string | null
}

export function useWebRTC({ currentUserId, conversationId }: UseWebRTCProps) {
  const [callState, setCallState] = useState<CallState>('idle')
  const [callType, setCallType] = useState<'audio' | 'video'>('audio')
  const [callId, setCallId] = useState<string | null>(null)
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const [callDuration, setCallDuration] = useState(0)

  // Refs for mutable state to avoid stale closures in the signal handler
  const callStateRef = useRef<CallState>('idle')
  const callIdRef = useRef<string | null>(null)
  const isScreenSharingRef = useRef(false)

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  // Store the sender for the video slot so we can replaceTrack reliably
  const videoSenderRef = useRef<RTCRtpSender | null>(null)
  // Store the sender for the screen audio so we can remove it cleanly
  const screenAudioSenderRef = useRef<RTCRtpSender | null>(null)

  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([])
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringtoneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringtoneCtxRef = useRef<AudioContext | null>(null)

  const supabase = createClient()

  // Keep refs in sync with state
  useEffect(() => { callStateRef.current = callState }, [callState])
  useEffect(() => { callIdRef.current = callId }, [callId])
  useEffect(() => { isScreenSharingRef.current = isScreenSharing }, [isScreenSharing])

  // Helper: attach stream to a media element
  const attachStream = useCallback((el: HTMLVideoElement | HTMLAudioElement | null, stream: MediaStream | null) => {
    if (el && stream) {
      el.srcObject = stream
    }
  }, [])

  // Ringtone
  const startRingtone = useCallback(() => {
    try {
      const ctx = new AudioContext()
      ringtoneCtxRef.current = ctx

      const playTone = () => {
        if (!ringtoneCtxRef.current || ringtoneCtxRef.current.state === 'closed') return
        const osc = ringtoneCtxRef.current.createOscillator()
        const gain = ringtoneCtxRef.current.createGain()
        osc.connect(gain)
        gain.connect(ringtoneCtxRef.current.destination)
        osc.frequency.setValueAtTime(440, ringtoneCtxRef.current.currentTime)
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.1, ringtoneCtxRef.current.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ringtoneCtxRef.current.currentTime + 0.8)
        osc.start(ringtoneCtxRef.current.currentTime)
        osc.stop(ringtoneCtxRef.current.currentTime + 0.8)
      }

      playTone()
      ringtoneIntervalRef.current = setInterval(playTone, 2000)
    } catch {
      // Audio not available
    }
  }, [])

  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current)
      ringtoneIntervalRef.current = null
    }
    if (ringtoneCtxRef.current && ringtoneCtxRef.current.state !== 'closed') {
      ringtoneCtxRef.current.close()
      ringtoneCtxRef.current = null
    }
  }, [])

  // Cleanup media & peer connection
  const cleanupMedia = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    stopRingtone()

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
    remoteStreamRef.current = null
    videoSenderRef.current = null
    screenAudioSenderRef.current = null
    iceCandidatesQueue.current = []
    setCallDuration(0)
    setIsMuted(false)
    setIsCameraOff(false)
    setIsScreenSharing(false)
    setHasVideo(false)
  }, [stopRingtone])

  // Send signal via Supabase Realtime broadcast
  const sendSignal = useCallback((signal: WebRTCSignal) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'webrtc-signal',
        payload: signal,
      })
    }
  }, [])

  // Get media stream
  const getMediaStream = useCallback(async (type: 'audio' | 'video') => {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: type === 'video' ? { width: 640, height: 480, facingMode: 'user' } : false,
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    localStreamRef.current = stream
    // Attach immediately if element exists; also re-attached later when component mounts
    attachStream(localVideoRef.current, stream)
    return stream
  }, [attachStream])

  // Create peer connection with a specific callId (passed explicitly to avoid stale ref)
  const createPeerConnection = useCallback(
    (stream: MediaStream, forCallId: string) => {
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnectionRef.current = pc

      // Add tracks and remember the video sender
      stream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, stream)
        if (track.kind === 'video') {
          videoSenderRef.current = sender
        }
      })

      // If audio-only call, add a placeholder video transceiver so we can add video later
      // via replaceTrack without renegotiation
      if (!stream.getVideoTracks().length) {
        const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' })
        videoSenderRef.current = transceiver.sender
      }

      const remoteStream = new MediaStream()
      remoteStreamRef.current = remoteStream

      pc.ontrack = (event) => {
        // Add tracks from the event — handle both stream-based and individual tracks
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
        // Attach to media elements
        attachStream(remoteVideoRef.current, remoteStream)
        attachStream(remoteAudioRef.current, remoteStream)
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            callId: forCallId,
          })
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          sendSignal({ type: 'call-end', callId: forCallId })
          stopRingtone()
          cleanupMedia()
          setCallState('ended')
          setTimeout(() => {
            setCallState('idle')
            setCallId(null)
            setRemoteUserId(null)
          }, 2000)
        }
      }

      // Handle renegotiation triggered by addTrack / removeTrack
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          sendSignal({
            type: 'offer',
            sdp: pc.localDescription!,
            callId: forCallId,
            callerId: currentUserId!,
            calleeId: '',
            callType: 'video',
          })
        } catch (err) {
          console.error('Renegotiation failed:', err)
        }
      }

      return pc
    },
    [currentUserId, sendSignal, stopRingtone, cleanupMedia, attachStream]
  )

  // Start a call (caller side)
  const startCall = useCallback(
    async (targetUserId: string, type: 'audio' | 'video') => {
      if (!currentUserId || !conversationId) return

      try {
        setCallType(type)
        setRemoteUserId(targetUserId)
        setCallState('calling')
        setHasVideo(type === 'video')

        const newCallId = crypto.randomUUID()
        setCallId(newCallId)

        const stream = await getMediaStream(type)
        const pc = createPeerConnection(stream, newCallId)

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        sendSignal({
          type: 'offer',
          sdp: offer,
          callId: newCallId,
          callerId: currentUserId,
          calleeId: targetUserId,
          callType: type,
        })

        // Save to DB (best-effort)
        supabase.from('calls').insert({
          id: newCallId,
          conversation_id: conversationId,
          caller_id: currentUserId,
          callee_id: targetUserId,
          type,
          status: 'ringing',
        }).then(() => {})

        startRingtone()
      } catch (err) {
        console.error('Failed to start call:', err)
        cleanupMedia()
        setCallState('idle')
      }
    },
    [currentUserId, conversationId, getMediaStream, createPeerConnection, sendSignal, supabase, startRingtone, cleanupMedia]
  )

  // Answer a call (callee side)
  const answerCall = useCallback(async () => {
    const currentCallId = callIdRef.current
    if (!currentCallId || !peerConnectionRef.current) return

    try {
      stopRingtone()
      setCallState('active')

      const pc = peerConnectionRef.current
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      sendSignal({
        type: 'answer',
        sdp: answer,
        callId: currentCallId,
      })

      // Process queued ICE candidates
      for (const candidate of iceCandidatesQueue.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      }
      iceCandidatesQueue.current = []

      // Update DB
      supabase
        .from('calls')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', currentCallId)
        .then(() => {})

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      console.error('Failed to answer call:', err)
      cleanupMedia()
      setCallState('idle')
    }
  }, [sendSignal, supabase, stopRingtone, cleanupMedia])

  // Decline a call
  const declineCall = useCallback(async () => {
    const currentCallId = callIdRef.current
    if (!currentCallId) return

    stopRingtone()
    sendSignal({ type: 'call-decline', callId: currentCallId })

    supabase
      .from('calls')
      .update({ status: 'declined', ended_at: new Date().toISOString() })
      .eq('id', currentCallId)
      .then(() => {})

    cleanupMedia()
    setCallState('idle')
    setCallId(null)
    setRemoteUserId(null)
  }, [sendSignal, supabase, stopRingtone, cleanupMedia])

  // End a call
  const endCall = useCallback(async () => {
    const currentCallId = callIdRef.current
    if (currentCallId) {
      sendSignal({ type: 'call-end', callId: currentCallId })

      supabase
        .from('calls')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', currentCallId)
        .then(() => {})
    }

    stopRingtone()
    cleanupMedia()
    setCallState('idle')
    setCallId(null)
    setRemoteUserId(null)
  }, [sendSignal, supabase, stopRingtone, cleanupMedia])

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

  // Toggle camera on/off for video calls (just enables/disables existing track)
  const toggleCamera = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsCameraOff(!videoTrack.enabled)
      }
    }
  }, [])

  // Enable camera mid-call (for audio calls — uses replaceTrack on the pre-allocated video sender)
  const enableCamera = useCallback(async () => {
    const pc = peerConnectionRef.current
    const sender = videoSenderRef.current
    if (!pc || !localStreamRef.current || !sender) return

    // If screen sharing, stop it first
    if (isScreenSharingRef.current) {
      await stopScreenShareInternal()
    }

    try {
      const existingVideoTrack = localStreamRef.current.getVideoTracks()[0]
      if (existingVideoTrack && existingVideoTrack.readyState === 'live') {
        existingVideoTrack.enabled = true
        setIsCameraOff(false)
        setHasVideo(true)
        return
      }

      // Get a camera stream
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      const camTrack = camStream.getVideoTracks()[0]

      // Use replaceTrack — no renegotiation needed
      await sender.replaceTrack(camTrack)

      // Add to local stream for preview
      localStreamRef.current.addTrack(camTrack)
      attachStream(localVideoRef.current, localStreamRef.current)

      setHasVideo(true)
      setIsCameraOff(false)
    } catch (err) {
      console.error('Failed to enable camera:', err)
    }
  }, [attachStream])

  // Disable camera (stop track, replace sender with null)
  const disableCamera = useCallback(async () => {
    const sender = videoSenderRef.current
    if (!localStreamRef.current || !sender) return

    const videoTrack = localStreamRef.current.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.stop()
      localStreamRef.current.removeTrack(videoTrack)
    }

    // Replace sender track with null (keeps the transceiver alive for future use)
    try {
      await sender.replaceTrack(null)
    } catch {
      // Ignore
    }

    setHasVideo(false)
    setIsCameraOff(true)
  }, [])

  // Internal: stop screen share without toggling state (used by enableCamera)
  const stopScreenShareInternal = useCallback(async () => {
    const pc = peerConnectionRef.current
    const sender = videoSenderRef.current
    if (!pc || !localStreamRef.current) return

    // Stop screen tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }

    // Remove screen audio sender if we added one
    if (screenAudioSenderRef.current) {
      try {
        pc.removeTrack(screenAudioSenderRef.current)
      } catch {
        // Ignore
      }
      screenAudioSenderRef.current = null
    }

    // Remove screen video track from local stream
    const oldVideoTrack = localStreamRef.current.getVideoTracks()[0]
    if (oldVideoTrack) {
      localStreamRef.current.removeTrack(oldVideoTrack)
    }

    // Set sender to null
    if (sender) {
      try {
        await sender.replaceTrack(null)
      } catch {
        // Ignore
      }
    }

    setIsScreenSharing(false)
    setHasVideo(false)
  }, [])

  // Toggle screen share with system audio
  const toggleScreenShare = useCallback(async () => {
    const pc = peerConnectionRef.current
    const sender = videoSenderRef.current
    if (!pc || !localStreamRef.current || !sender) return

    if (isScreenSharingRef.current) {
      // --- STOP screen sharing ---
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop())
        screenStreamRef.current = null
      }

      // Remove screen audio sender cleanly
      if (screenAudioSenderRef.current) {
        try {
          pc.removeTrack(screenAudioSenderRef.current)
        } catch {
          // Ignore
        }
        screenAudioSenderRef.current = null
      }

      // Remove old video track from local stream
      const oldVideoTrack = localStreamRef.current.getVideoTracks()[0]
      if (oldVideoTrack) {
        localStreamRef.current.removeTrack(oldVideoTrack)
      }

      // Try to restore camera
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        const camTrack = camStream.getVideoTracks()[0]

        await sender.replaceTrack(camTrack)
        localStreamRef.current.addTrack(camTrack)
        attachStream(localVideoRef.current, localStreamRef.current)

        setHasVideo(true)
        setIsCameraOff(false)
      } catch {
        // Camera not available — go to no-video state
        try {
          await sender.replaceTrack(null)
        } catch {
          // Ignore
        }
        setHasVideo(false)
      }

      setIsScreenSharing(false)
      return
    }

    // --- START screen sharing ---
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      screenStreamRef.current = screenStream

      const screenVideoTrack = screenStream.getVideoTracks()[0]
      const screenAudioTrack = screenStream.getAudioTracks()[0]

      // Replace video sender track with screen video (no renegotiation)
      await sender.replaceTrack(screenVideoTrack)

      // Add screen audio as a new track (this IS a new sender, but won't interfere with mic)
      if (screenAudioTrack) {
        const audioSender = pc.addTrack(screenAudioTrack, screenStream)
        screenAudioSenderRef.current = audioSender
      }

      // Stop and replace local video track
      const oldVideoTrack = localStreamRef.current.getVideoTracks()[0]
      if (oldVideoTrack) {
        oldVideoTrack.stop()
        localStreamRef.current.removeTrack(oldVideoTrack)
      }
      localStreamRef.current.addTrack(screenVideoTrack)
      attachStream(localVideoRef.current, localStreamRef.current)

      setIsScreenSharing(true)
      setHasVideo(true)

      // When user stops sharing via browser UI
      screenVideoTrack.onended = () => {
        // Use ref to get fresh state
        if (isScreenSharingRef.current) {
          toggleScreenShare()
        }
      }
    } catch (err) {
      console.error('Failed to start screen sharing:', err)
    }
  }, [attachStream])

  // Subscribe to signaling channel — uses refs so no re-subscription on state changes
  useEffect(() => {
    if (!currentUserId || !conversationId) return

    const channel = supabase.channel(`calls:${conversationId}`)

    channel
      .on('broadcast', { event: 'webrtc-signal' }, async ({ payload }: { payload: WebRTCSignal }) => {
        const signal = payload

        switch (signal.type) {
          case 'offer': {
            // If we are already in a call and receive a new offer, it's a renegotiation
            if (callStateRef.current === 'active' && signal.callId === callIdRef.current && peerConnectionRef.current) {
              try {
                const pc = peerConnectionRef.current
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                channel.send({
                  type: 'broadcast',
                  event: 'webrtc-signal',
                  payload: { type: 'answer', sdp: answer, callId: signal.callId },
                })
              } catch (err) {
                console.error('Renegotiation answer failed:', err)
              }
              return
            }

            if (signal.calleeId !== currentUserId) return
            if (callStateRef.current !== 'idle') {
              // Busy — auto-decline
              channel.send({
                type: 'broadcast',
                event: 'webrtc-signal',
                payload: { type: 'call-decline', callId: signal.callId },
              })
              return
            }

            setCallId(signal.callId)
            setRemoteUserId(signal.callerId)
            setCallType(signal.callType)
            setHasVideo(signal.callType === 'video')
            setCallState('ringing')

            try {
              const stream = await getMediaStream(signal.callType)
              const pc = createPeerConnection(stream, signal.callId)
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
              startRingtone()
            } catch (err) {
              console.error('Failed to handle offer:', err)
              cleanupMedia()
              setCallState('idle')
            }
            break
          }

          case 'answer': {
            if (signal.callId !== callIdRef.current || !peerConnectionRef.current) return

            const pc = peerConnectionRef.current
            // Only set remote description if we're in a state that expects an answer
            if (pc.signalingState === 'have-local-offer') {
              stopRingtone()
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))

              for (const candidate of iceCandidatesQueue.current) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate))
              }
              iceCandidatesQueue.current = []

              // Only start timer if not already active (first answer)
              if (callStateRef.current !== 'active') {
                setCallState('active')
                durationIntervalRef.current = setInterval(() => {
                  setCallDuration((prev) => prev + 1)
                }, 1000)
              }
            }
            break
          }

          case 'ice-candidate': {
            if (signal.callId !== callIdRef.current) return

            if (peerConnectionRef.current?.remoteDescription) {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate))
            } else {
              iceCandidatesQueue.current.push(signal.candidate)
            }
            break
          }

          case 'call-end':
          case 'call-decline': {
            if (signal.callId !== callIdRef.current) return

            stopRingtone()
            cleanupMedia()
            setCallState('ended')
            setTimeout(() => {
              setCallState('idle')
              setCallId(null)
              setRemoteUserId(null)
            }, 2000)
            break
          }
        }
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  // Only re-subscribe when user or conversation changes, NOT on state changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, conversationId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupMedia()
    }
  }, [cleanupMedia])

  return {
    callState,
    callType,
    callId,
    remoteUserId,
    isMuted,
    isCameraOff,
    isScreenSharing,
    hasVideo,
    callDuration,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    remoteStream: remoteStreamRef,
    localStream: localStreamRef,
    startCall,
    answerCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    enableCamera,
    disableCamera,
    toggleScreenShare,
  }
}
