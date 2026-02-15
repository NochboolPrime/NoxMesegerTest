'use client'

import { useCallback, useRef } from 'react'

export function useNotificationSound() {
  const audioContextRef = useRef<AudioContext | null>(null)

  const play = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext()
      }
      const ctx = audioContextRef.current

      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)

      oscillator.frequency.setValueAtTime(880, ctx.currentTime)
      oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.08)
      oscillator.type = 'sine'

      gainNode.gain.setValueAtTime(0.15, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)

      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.3)
    } catch {
      // Silently fail if audio is not available
    }
  }, [])

  return { play }
}
