<template>
  <div class="call-room card">
    <div style="display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap;">
      <div style="min-width:260px; width:360px;">
        <div style="font-weight:700; margin-bottom:8px">You</div>
        <video ref="localVideo" autoplay muted playsinline style="width:100%; border-radius:10px; background:#000;"></video>
        <div class="row" style="gap:8px; margin-top:8px;">
          <button @click="toggleAudio">{{ localAudioEnabled ? 'Mute' : 'Unmute' }}</button>
          <button @click="toggleVideo">{{ localVideoEnabled ? 'Stop Video' : 'Start Video' }}</button>
          <button @click="toggleScreenShare">{{ screenSharing ? 'Stop Share' : 'Share Screen' }}</button>
          <button class="danger" @click="leave">Leave</button>
        </div>
      </div>

      <div style="flex:1; min-width:320px;">
        <div style="font-weight:700; margin-bottom:8px">Participants</div>
        <div v-if="Object.keys(remoteStreams).length === 0" class="small">No other peers yet</div>
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <VideoTile
            v-for="(s, id) in remoteStreams"
            :key="id"
            :stream="s.stream"
            :label="s.label || id"
            :muted="false"
            :isActive="true"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { io } from 'socket.io-client'
import VideoTile from './VideoTile.vue'

// EDIT: set the correct WS_URL for your project (same as chat)
const WS_URL = 'http://localhost:5000' // <- change if your backend URL differs

// props (roomId passed when mounting this component)
const props = defineProps({
  roomId: { type: String, required: true },
  userInfo: { type: Object, default: () => ({}) } // optional user meta
})

// local refs
const localVideo = ref(null)
const localStream = ref(null)
const localAudioEnabled = ref(true)
const localVideoEnabled = ref(true)
const screenSharing = ref(false)

// remote streams map: { socketId: { stream, label } }
const remoteStreams = reactive({})

// peer connections map
const pcs = {} // socketId -> RTCPeerConnection

// socket
const socket = io(WS_URL, { auth: {} })

// ICE servers: add TURN here if you have one
const pcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // { urls: 'turn:your-turn-server', username: 'u', credential: 'p' }
  ]
}

async function startLocalMedia() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localStream.value = s
    if (localVideo.value) localVideo.value.srcObject = s
    localAudioEnabled.value = s.getAudioTracks().some(t => t.enabled)
    localVideoEnabled.value = s.getVideoTracks().some(t => t.enabled)
  } catch (e) {
    console.error('getUserMedia failed', e)
    alert('Camera / microphone access required for calls.')
  }
}

function createPeerConnection(remoteSocketId) {
  const pc = new RTCPeerConnection(pcConfig)

  // forward local tracks
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => pc.addTrack(track, localStream.value))
  }

  // ontrack -> build remote stream
  pc.ontrack = (ev) => {
    const existing = remoteStreams[remoteSocketId]?.stream
    if (existing) {
      // append tracks to same MediaStream
      ev.streams[0].getTracks().forEach(t => existing.addTrack(t))
      return
    }
    // create new stream container
    const ms = new MediaStream()
    ev.streams[0].getTracks().forEach(t => ms.addTrack(t))
    remoteStreams[remoteSocketId] = { stream: ms, label: `peer:${remoteSocketId}` }
  }

  // ICE candidates -> send to remote
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit('rtc:ice', { to: remoteSocketId, candidate: ev.candidate, roomId: props.roomId })
    }
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      // cleanup
      removePeer(remoteSocketId)
    }
  }

  pcs[remoteSocketId] = pc
  return pc
}

function removePeer(id) {
  const pc = pcs[id]
  if (pc) {
    try { pc.close() } catch {}
    delete pcs[id]
  }
  if (remoteStreams[id]) delete remoteStreams[id]
}

// Signaling handlers
socket.on('connect', () => {
  console.log('rtc socket connected', socket.id)
  // join room on connect
  socket.emit('rtc:join', { roomId: props.roomId, user: props.userInfo || {} })
})

socket.on('rtc:peer-joined', async ({ socketId, user }) => {
  console.log('peer joined', socketId)
  // create pc and make an offer to the new peer
  const pc = createPeerConnection(socketId)
  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('rtc:offer', { to: socketId, sdp: offer, roomId: props.roomId })
  } catch (e) {
    console.error('offer failed', e)
  }
})

socket.on('rtc:offer', async ({ from, sdp }) => {
  console.log('recv offer from', from)
  const pc = pcs[from] || createPeerConnection(from)
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    socket.emit('rtc:answer', { to: from, sdp: answer, roomId: props.roomId })
  } catch (e) {
    console.error('handle offer failed', e)
  }
})

socket.on('rtc:answer', async ({ from, sdp }) => {
  console.log('recv answer from', from)
  const pc = pcs[from]
  if (!pc) return console.warn('pc missing for', from)
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  } catch (e) { console.error(e) }
})

socket.on('rtc:ice', async ({ from, candidate }) => {
  const pc = pcs[from]
  if (!pc) return
  try {
    await pc.addIceCandidate(candidate)
  } catch (e) {
    console.warn('addIce failed', e)
  }
})

socket.on('rtc:peer-left', ({ socketId }) => {
  console.log('peer left', socketId)
  removePeer(socketId)
})

// UI actions
function toggleAudio() {
  if (!localStream.value) return
  const t = localStream.value.getAudioTracks()[0]
  if (!t) return
  t.enabled = !t.enabled
  localAudioEnabled.value = t.enabled
}
function toggleVideo() {
  if (!localStream.value) return
  const t = localStream.value.getVideoTracks()[0]
  if (!t) return
  t.enabled = !t.enabled
  localVideoEnabled.value = t.enabled
}

async function toggleScreenShare() {
  if (screenSharing.value) {
    // stop screen sharing: replace sender track with camera track
    stopScreenShare()
    return
  }
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
    const screenTrack = screenStream.getVideoTracks()[0]
    // replace each pc video sender
    Object.values(pcs).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
      if (sender) sender.replaceTrack(screenTrack)
    })
    screenSharing.value = true
    // when screen sharing stops -> revert to camera
    screenTrack.onended = () => stopScreenShare()
  } catch (e) {
    console.error('screen share failed', e)
  }
}

function stopScreenShare() {
  if (!localStream.value) return
  const camTrack = localStream.value.getVideoTracks()[0]
  Object.values(pcs).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
    if (sender && camTrack) sender.replaceTrack(camTrack)
  })
  screenSharing.value = false
}

function leave() {
  // inform server and cleanup
  socket.emit('rtc:leave', { roomId: props.roomId })
  for (const id of Object.keys(pcs)) removePeer(id)
  if (localStream.value) {
    localStream.value.getTracks().forEach(t => t.stop())
    localStream.value = null
  }
  if (localVideo.value) localVideo.value.srcObject = null
}

// lifecycle
onMounted(async () => {
  await startLocalMedia()
  // joining happens when socket connects (see above)
})

onBeforeUnmount(() => {
  leave()
  try { socket.disconnect() } catch {}
})
</script>

<style scoped>
.call-room { padding: 12px; }
.row { display:flex; gap:8px; align-items:center; }
button { padding:8px 12px; border-radius:8px; border:0; background:#1f6feb; color:white; cursor:pointer; }
button.ghost { background:transparent; color:inherit; border:1px solid rgba(255,255,255,0.06); }
button.danger { background:#ef4444; }
.small { color:#94a3b8; }
</style>
