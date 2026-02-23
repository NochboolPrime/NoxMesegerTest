# WebRTC Video Bug Fix - Group Calls

## Problem Description

В групповых звонках (group calls):
- Демонстрация экрана (screen sharing) видна только человеку который создал звонок
- Видео и демонстрации других участников не отображаются

(In group calls:
- Screen sharing is only visible to the person who created the call
- Video and screen sharing from other participants is not visible)

## Root Cause

The bug was caused by three main issues in the WebRTC implementation:

### 1. **Renegotiation Restriction**
The original code prevented non-offerers (call joiners) from initiating WebRTC renegotiation:

```typescript
// OLD CODE (lines 249-271)
pc.onnegotiationneeded = async () => {
  // Only offerer initiates renegotiation to avoid glare
  if (!isOfferer) return  // ❌ BUG: Joiners couldn't initiate renegotiation
  // ...
}
```

**Impact:** When a joiner enabled their camera or started screen sharing, their video track was never sent to other participants because they couldn't trigger renegotiation.

### 2. **replaceTrack() Without Renegotiation**
The `replaceTrack()` method was used to switch between camera and screen share tracks, but it doesn't always trigger renegotiation automatically in all browsers.

**Impact:** Even when tracks were replaced, remote peers didn't always receive the new video stream.

### 3. **No Glare Handling**
When both peers tried to renegotiate simultaneously, there was no collision detection mechanism, which could cause negotiation failures.

## Solution

### 1. **Allow All Participants to Initiate Renegotiation**
```typescript
// NEW CODE
pc.onnegotiationneeded = async () => {
  // Allow both offerer and answerer to initiate renegotiation
  // This is needed when a joiner enables camera/screen share
  if (makingOfferRef.current.get(remoteUserId)) {
    return // Already negotiating
  }
  // ... create and send offer
}
```

### 2. **Implement Perfect Negotiation with Glare Detection**
```typescript
// When receiving an offer during ongoing negotiation
const isOfferer = currentUserId! > signal.fromUserId // Stable ordering
const makingOffer = makingOfferRef.current.get(signal.fromUserId)

if (makingOffer && !isOfferer) {
  // We're the polite peer - rollback our offer
  await pc.setLocalDescription({ type: 'rollback' })
  makingOfferRef.current.set(signal.fromUserId, false)
} else if (makingOffer && isOfferer) {
  // We're the impolite peer - ignore their offer
  return
}
```

### 3. **Force Renegotiation After Track Replacement**
```typescript
const replaceVideoTrackOnAllPeers = async (track: MediaStreamTrack | null) => {
  // Replace track on all peer connections
  await Promise.all(replacePromises)
  
  // Manually trigger renegotiation to ensure remote peers receive the new track
  setTimeout(() => {
    if (pc.onnegotiationneeded) {
      pc.onnegotiationneeded(new Event('negotiationneeded'))
    }
  }, 100)
}
```

## Debug Logging

Comprehensive console.log statements have been added with the `[v0]` prefix to trace:
- Track creation and replacement
- Signaling events (offers, answers, ICE candidates)
- Media state broadcasts
- UI rendering of video streams
- Renegotiation triggers

To debug issues, open the browser console and filter for `[v0]` logs.

## Testing Checklist

After deploying this fix, test the following scenarios:

1. **Call Creator Enables Video**
   - [ ] User A creates a group call
   - [ ] User B joins the call
   - [ ] User A enables their camera
   - [ ] Verify User B can see User A's video

2. **Joiner Enables Video**
   - [ ] User A creates a group call
   - [ ] User B joins the call
   - [ ] User B enables their camera
   - [ ] Verify User A can see User B's video ✅ (This was broken before)

3. **Screen Sharing from Joiner**
   - [ ] User A creates a group call
   - [ ] User B joins the call
   - [ ] User B starts screen sharing
   - [ ] Verify User A can see User B's screen ✅ (This was broken before)

4. **Multiple Participants**
   - [ ] User A creates a group call
   - [ ] Users B, C, D join
   - [ ] All users enable video/screen share in random order
   - [ ] Verify all participants can see each other

5. **Simultaneous Actions**
   - [ ] Two users enable video at the same time
   - [ ] Verify no glare/collision issues

## Notes

- The debug logs should be removed after confirming the fix works in production
- The perfect negotiation pattern is based on the WebRTC specification
- User ID comparison provides a stable ordering for glare resolution

## Remove Debug Logs

Once the fix is confirmed working, remove all console.log statements with the `[v0]` prefix from:
- `/hooks/use-group-webrtc.ts`
- `/components/chat/group-call-screen.tsx`
