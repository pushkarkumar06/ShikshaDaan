<template>
  <div class="call-room card">
    <div style="display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap;">
      <!-- Local -->
      <div style="min-width:260px; width:360px;">
        <div style="font-weight:700; margin-bottom:8px">You</div>

        <div class="video-wrap">
          <video ref="localVideo" autoplay muted playsinline class="local-video"></video>
          <div v-if="permissionError" class="perm-error">
            {{ permissionError }}
          </div>
        </div>

        <div class="row" style="gap:8px; margin-top:8px;">
          <button @click="toggleAudio">{{ localAudioEnabled ? 'Mute' : 'Unmute' }}</button>
          <button @click="toggleVideo">{{ localVideoEnabled ? 'Stop Video' : 'Start Video' }}</button>
          <button @click="toggleScreenShare">{{ screenSharing ? 'Stop Share' : 'Share Screen' }}</button>

          <button v-if="joinableExternally" @click="openExternal" class="secondary">
            Join (external)
          </button>

          <button v-if="sessionId && !joinableExternally" @click="generateAndOpenJoinLink" class="secondary">
            Generate & Join
          </button>

          <button class="danger" @click="leave">Leave</button>
        </div>
      </div>

      <!-- Remote tiles -->
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
/*
  Enhanced CallRoom:
  - Accepts props: roomId (required), userInfo, wsUrl (optional), token (optional JWT),
    sessionId (optional) and externalJoinLink (optional).
  - If externalJoinLink provided (e.g. Zoom link on session), "Join (external)" opens it.
  - If no external link and sessionId provided, you can call POST /api/sessions/:id/join to generate a link.
  - Uses Socket.IO for in-app WebRTC signaling and gracefully handles getUserMedia permission errors.
*/

import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue';
import { io } from 'socket.io-client';
import VideoTile from './VideoTile.vue';

// props
const props = defineProps({
  roomId: { type: String, required: true },
  userInfo: { type: Object, default: () => ({ id: null, name: null }) },
  wsUrl: { type: String, default: null },
  token: { type: String, default: null },
  sessionId: { type: String, default: null },           // optional: session tied to this room
  externalJoinLink: { type: String, default: null },    // optional: e.g. zoom link
});

const emit = defineEmits(['left', 'error', 'joined']);

// computed-ish refs
const WS_URL = props.wsUrl || (window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : ''));

// refs/state
const localVideo = ref(null);
const localStream = ref(null);
const localAudioEnabled = ref(true);
const localVideoEnabled = ref(true);
const screenSharing = ref(false);
const permissionError = ref('');
const remoteStreams = reactive({}); // peerId -> { stream, label }
const pcs = {}; // peerId -> RTCPeerConnection

// local identity
const myId = props.userInfo?.id || props.userInfo?.userId || null;
const myName = props.userInfo?.name || props.userInfo?.userName || 'User';

// socket with auth header if token provided
const socketOptions = {
  transports: ['websocket', 'polling'],
  auth: props.token ? { token: props.token } : {},
  autoConnect: false,
};
const socket = io(WS_URL, socketOptions);

// simple STUN-only config (add TURN servers for production)
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// helpers
function safeLog(...args) { try { console.debug(...args); } catch {} }

async function startLocalMedia() {
  permissionError.value = '';
  // request audio+video with retries for user-friendly errors
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.value = s;
    if (localVideo.value) localVideo.value.srcObject = s;
    localAudioEnabled.value = !!s.getAudioTracks().length && s.getAudioTracks()[0].enabled;
    localVideoEnabled.value = !!s.getVideoTracks().length && s.getVideoTracks()[0].enabled;
    return true;
  } catch (err) {
    // handle permission denied vs not-available
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      permissionError.value = 'Permission denied: camera/microphone access is required for in-app calls. You can still join via external link.';
      emit('error', { code: 'perm_denied', error: err });
    } else {
      permissionError.value = 'Unable to access camera/microphone. Check device and browser settings.';
      emit('error', { code: 'media_unavailable', error: err });
    }
    console.error('getUserMedia failed', err);
    return false;
  }
}

function createPeerConnection(peerId) {
  if (pcs[peerId]) return pcs[peerId];
  const pc = new RTCPeerConnection(pcConfig);

  // add local tracks when available
  if (localStream.value) {
    localStream.value.getTracks().forEach(track => pc.addTrack(track, localStream.value));
  }

  pc.ontrack = (ev) => {
    const ms = (ev.streams && ev.streams[0]) ? ev.streams[0] : new MediaStream();
    // set or merge stream
    if (!remoteStreams[peerId]) {
      remoteStreams[peerId] = { stream: ms, label: `peer:${peerId}` };
    } else {
      try {
        ev.streams[0].getTracks().forEach(t => remoteStreams[peerId].stream.addTrack(t));
      } catch (e) { /* ignore */ }
    }
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit('call:ice', { roomId: props.roomId, candidate: ev.candidate, from: myId || socket.id, to: peerId });
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    safeLog('pc state', peerId, s);
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

// signaling handlers
socket.on('connect', () => {
  safeLog('call socket connected', socket.id);
  // join only after local media ready — parent already starts mounted flow
  socket.emit('call:join', { roomId: props.roomId, userId: myId || socket.id, name: myName });
});

socket.on('call:ready', async ({ peerId, name }) => {
  if (!peerId || peerId === (myId || socket.id)) return;
  safeLog('call:ready from', peerId, name);

  const pc = createPeerConnection(peerId);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:offer', { roomId: props.roomId, to: peerId, offer, from: myId || socket.id });
  } catch (e) {
    console.error('create/send offer failed', e);
    emit('error', { code: 'offer_failed', error: e });
  }
});

socket.on('call:offer', async ({ from, offer }) => {
  if (!from || from === (myId || socket.id)) return;
  safeLog('received offer from', from);
  const pc = createPeerConnection(from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('call:answer', { roomId: props.roomId, answer, from: myId || socket.id, to: from });
  } catch (e) {
    console.error('handle offer failed', e);
    emit('error', { code: 'handle_offer_failed', error: e });
  }
});

socket.on('call:answer', async ({ from, answer }) => {
  if (!from || from === (myId || socket.id)) return;
  const pc = pcs[from];
  if (!pc) return safeLog('no pc for answer from', from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (e) {
    console.error('setRemoteDescription(answer) failed', e);
  }
});

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
  if (screenSharing.value) return stopScreenShare();
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    Object.values(pcs).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });
    screenSharing.value = true;
    screenTrack.onended = () => stopScreenShare();
  } catch (e) {
    console.error('screen share failed', e);
    emit('error', { code: 'screen_share_failed', error: e });
    alert('Screen share failed or permission denied.');
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
  try { socket.emit('call:leave', { roomId: props.roomId, userId: myId || socket.id }); } catch (e) {}
  // close peers
  Object.keys(pcs).forEach(id => removePeer(id));
  // stop local tracks
  if (localStream.value) {
    localStream.value.getTracks().forEach(t => { try { t.stop(); } catch {} });
    localStream.value = null;
  }
  if (localVideo.value) localVideo.value.srcObject = null;
  try { socket.disconnect(); } catch (e) {}
  emit('left', { roomId: props.roomId });
}

// External join helpers
const joinableExternally = ref(!!props.externalJoinLink || false);

function openExternal() {
  const url = props.externalJoinLink;
  if (!url) return alert('No external link provided.');
  window.open(url, '_blank');
}

// If no external link but sessionId provided, call backend to generate join link
let generating = ref(false);
async function generateAndOpenJoinLink() {
  if (!props.sessionId) return alert('No session id available to generate link.');
  if (generating.value) return;
  generating.value = true;
  try {
    const headers = {};
    if (props.token) headers['Authorization'] = `Bearer ${props.token}`;
    const res = await fetch(`/api/sessions/${props.sessionId}/join`, { method: 'POST', headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `Status ${res.status}`);
    }
    const data = await res.json();
    const link = data?.zoomLink || data?.joinUrl || data?.url;
    if (link) window.open(link, '_blank');
    else alert('Server did not return a join link.');
  } catch (e) {
    console.error('generate join failed', e);
    emit('error', { code: 'join_generate_failed', error: e });
    alert('Failed to generate meeting link. ' + (e?.message || ''));
  } finally {
    generating.value = false;
  }
}

// lifecycle: start media then connect socket and emit join
onMounted(async () => {
  const ok = await startLocalMedia();
  // connect socket after media attempt (even if media failed we still can join external link)
  try { socket.connect(); } catch (e) { console.warn('socket connect failed', e); }

  // if local media available, attach tracks to any new PC created later
  if (ok && localStream.value) {
    // emit join (server will forward call:ready to other participants)
    try {
      socket.emit('call:join', { roomId: props.roomId, userId: myId || socket.id, name: myName });
    } catch (e) { /* ignore */ }
  }
});

// cleanup
onBeforeUnmount(() => {
  leave();
});
</script>

<style scoped>
.call-room { padding: 12px; }
.row { display:flex; gap:8px; align-items:center; }
button { padding:8px 12px; border-radius:8px; border:0; background:#1f6feb; color:white; cursor:pointer; }
button.secondary { background:#64748b; }
button.danger { background:#ef4444; }
.video-wrap { position:relative; width:100%; }
.local-video { width:100%; border-radius:10px; background:#000; height:220px; object-fit:cover; }
.perm-error { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:12px; color:white; background: linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.6)); text-align:center; border-radius:10px; }
.small { color:#94a3b8; }
.card { background:#fff; border-radius:10px; box-shadow:0 6px 18px rgba(2,6,23,0.06); }
</style>


