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
            v-for="(s, peerId) in remoteStreams"
            :key="peerId"
            :stream="s.stream"
            :label="s.label || peerId"
            :muted="false"
            :isActive="true"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue';
import { io } from 'socket.io-client';
import VideoTile from './VideoTile.vue';

// Props
const props = defineProps({
  roomId: { type: String, required: true },
  userInfo: { type: Object, default: () => ({ id: null, name: null }) },
  wsUrl: { type: String, default: null }, // optional override
  token: { type: String, default: null }  // optional JWT token
});

// defaults
const WS_URL = props.wsUrl || (window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : ''));

// refs
const localVideo = ref(null);
const localStream = ref(null);
const localAudioEnabled = ref(true);
const localVideoEnabled = ref(true);
const screenSharing = ref(false);

const remoteStreams = reactive({}); // peerId -> { stream, label }
const pcs = {}; // peerId -> RTCPeerConnection

// create socket with optional auth token
const socket = io(WS_URL, {
  auth: props.token ? { token: props.token } : {},
  transports: ['websocket']
});

// simple stun-only config (add TURN in production)
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function startLocalMedia() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.value = s;
    if (localVideo.value) localVideo.value.srcObject = s;
    localAudioEnabled.value = s.getAudioTracks().some(t => t.enabled);
    localVideoEnabled.value = s.getVideoTracks().some(t => t.enabled);
  } catch (e) {
    console.error('getUserMedia failed', e);
    alert('Camera / microphone access required for calls.');
  }
}

function createPeerConnection(peerId) {
  if (pcs[peerId]) return pcs[peerId];
  const pc = new RTCPeerConnection(pcConfig);

  // add local tracks
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => pc.addTrack(track, localStream.value));
  }

  // when remote track arrives
  pc.ontrack = (ev) => {
    const ms = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream();
    // if new, set up remoteStreams entry
    if (!remoteStreams[peerId]) {
      remoteStreams[peerId] = { stream: ms, label: `peer:${peerId}` };
    } else {
      // add tracks to existing stream
      ev.streams[0].getTracks().forEach(t => remoteStreams[peerId].stream.addTrack(t));
    }
  };

  // ICE -> emit to server target peer via room
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit('call:ice', { roomId: props.roomId, candidate: ev.candidate, from: myId, to: peerId });
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'failed' || s === 'disconnected' || s === 'closed') {
      removePeer(peerId);
    }
  };

  pcs[peerId] = pc;
  return pc;
}

function removePeer(peerId) {
  const pc = pcs[peerId];
  if (pc) {
    try { pc.close(); } catch (e) {}
    delete pcs[peerId];
  }
  if (remoteStreams[peerId]) delete remoteStreams[peerId];
}

// local identity
const myId = props.userInfo?.id || props.userInfo?.userId || null;
const myName = props.userInfo?.name || props.userInfo?.userName || 'User';

// SIGNALING: call:* events
socket.on('connect', () => {
  console.log('call socket connected', socket.id);
  // join the call room as soon as local media started/ready
  socket.emit('call:join', { roomId: props.roomId, userId: myId || socket.id, name: myName });
});

// server notifies when others are ready
socket.on('call:ready', async ({ peerId, name }) => {
  // peerId is the other user's id (as sent by their client)
  if (!peerId || peerId === (myId || socket.id)) return;
  console.log('call:ready from', peerId, name);

  // create PC and offer
  const pc = createPeerConnection(peerId);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:offer', { roomId: props.roomId, to: peerId, offer, from: myId || socket.id });
  } catch (e) {
    console.error('create/send offer failed', e);
  }
});

// incoming offer (from peer through room)
socket.on('call:offer', async ({ from, offer }) => {
  if (!from || from === (myId || socket.id)) return;
  console.log('received offer from', from);
  const pc = createPeerConnection(from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('call:answer', { roomId: props.roomId, answer, from: myId || socket.id });
  } catch (e) {
    console.error('handle offer failed', e);
  }
});

// incoming answer broadcasted in room (note: server emits to room)
socket.on('call:answer', async ({ from, answer }) => {
  if (!from || from === (myId || socket.id)) return;
  const pc = pcs[from];
  if (!pc) return console.warn('no pc for answer from', from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (e) {
    console.error('setRemoteDescription(answer) failed', e);
  }
});

// ICE candidates from others
socket.on('call:ice', async ({ from, candidate }) => {
  if (!from || from === (myId || socket.id)) return;
  const pc = pcs[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn('addIceCandidate failed', e);
  }
});

// someone left
socket.on('call:leave', ({ userId }) => {
  const pid = userId || null;
  if (!pid) return;
  removePeer(pid);
});

// UI actions
function toggleAudio() {
  if (!localStream.value) return;
  const t = localStream.value.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  localAudioEnabled.value = t.enabled;
}

function toggleVideo() {
  if (!localStream.value) return;
  const t = localStream.value.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  localVideoEnabled.value = t.enabled;
}

async function toggleScreenShare() {
  if (screenSharing.value) {
    stopScreenShare();
    return;
  }
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    // replace each pc video sender
    Object.values(pcs).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });
    screenSharing.value = true;
    screenTrack.onended = () => stopScreenShare();
  } catch (e) {
    console.error('screen share failed', e);
  }
}

function stopScreenShare() {
  if (!localStream.value) return;
  const camTrack = localStream.value.getVideoTracks()[0];
  Object.values(pcs).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && camTrack) sender.replaceTrack(camTrack);
  });
  screenSharing.value = false;
}

function leave() {
  try {
    socket.emit('call:leave', { roomId: props.roomId, userId: myId || socket.id });
  } catch (e) { /* ignore */ }

  // cleanup peers
  Object.keys(pcs).forEach(id => removePeer(id));

  // stop local tracks
  if (localStream.value) {
    localStream.value.getTracks().forEach(t => t.stop());
    localStream.value = null;
  }
  if (localVideo.value) localVideo.value.srcObject = null;

  try { socket.disconnect(); } catch (e) {}
}

// lifecycle
onMounted(async () => {
  await startLocalMedia();
  // join call room after local media ready
  socket.emit('call:join', { roomId: props.roomId, userId: myId || socket.id, name: myName });
});

onBeforeUnmount(() => {
  leave();
});
</script>

<style scoped>
.call-room { padding: 12px; }
.row { display:flex; gap:8px; align-items:center; }
button { padding:8px 12px; border-radius:8px; border:0; background:#1f6feb; color:white; cursor:pointer; }
button.ghost { background:transparent; color:inherit; border:1px solid rgba(255,255,255,0.06); }
button.danger { background:#ef4444; }
.small { color:#94a3b8; }
</style>
