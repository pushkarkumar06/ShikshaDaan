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

          <!-- If Zoom link already present -->
          <button v-if="joinableExternally" @click="openExternal" class="secondary">
            {{ isHost ? 'Start (Zoom)' : 'Join (Zoom)' }}
          </button>

          <!-- If no Zoom link yet, let user generate it (server enforces time window) -->
          <button
            v-if="sessionId && !joinableExternally"
            @click="generateAndOpenJoinLink"
            class="secondary"
            :disabled="generating"
          >
            <span v-if="generating">Working…</span>
            <span v-else>Generate & Join</span>
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
  CallRoom (Zoom-ready):
  - Props:
      roomId (required), userInfo, wsUrl?, token?, sessionId?, externalJoinLink?, isHost?
  - If externalJoinLink provided → open in new tab (Zoom).
  - If sessionId provided but no link → POST /api/rtc/zoom/meeting; fallback GET /api/sessions/:id/join
  - Listens for socket session events: meeting_link, ended, window_open
  - Keeps in-app WebRTC as fallback (TURN recommended for prod).
*/

import { ref, reactive, onMounted, onBeforeUnmount } from 'vue';
import { io } from 'socket.io-client';
import VideoTile from './VideoTile.vue';

const props = defineProps({
  roomId: { type: String, required: true },
  userInfo: { type: Object, default: () => ({ id: null, name: null, role: null }) },
  wsUrl: { type: String, default: null },
  token: { type: String, default: null },
  sessionId: { type: String, default: null },           // session tied to this room
  externalJoinLink: { type: String, default: null },    // pre-existing Zoom join URL (or start URL for host)
  isHost: { type: Boolean, default: false }             // volunteer=true => open startUrl when available
});

const emit = defineEmits(['left', 'error', 'joined', 'zoom:opened', 'zoom:generated']);

/* ------------------- env / auth helpers ------------------- */
const WS_URL = props.wsUrl || import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

function getAuthToken() {
  if (props.token) return props.token;
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}

/* ------------------- media / webrtc state ------------------- */
const localVideo = ref(null);
const localStream = ref(null);
const localAudioEnabled = ref(true);
const localVideoEnabled = ref(true);
const screenSharing = ref(false);
const permissionError = ref('');
const remoteStreams = reactive({}); // peerId -> { stream, label }
const pcs = {}; // peerId -> RTCPeerConnection

const myId = props.userInfo?.id || props.userInfo?.userId || null;
const myName = props.userInfo?.name || props.userInfo?.userName || 'User';
const myRole = (props.userInfo?.role || '').toLowerCase();

const socketOptions = {
  transports: ['websocket', 'polling'],
  auth: getAuthToken() ? { token: getAuthToken() } : {},
  autoConnect: false,
};
const socket = io(WS_URL, socketOptions);

// STUN (add TURN servers for production)
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function safeLog(...args) { try { console.debug(...args); } catch {} }

/* ------------------- local media ------------------- */
async function startLocalMedia() {
  permissionError.value = '';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.value = s;
    if (localVideo.value) localVideo.value.srcObject = s;
    localAudioEnabled.value = !!s.getAudioTracks().length && s.getAudioTracks()[0].enabled;
    localVideoEnabled.value = !!s.getVideoTracks().length && s.getVideoTracks()[0].enabled;
    return true;
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      permissionError.value = 'Permission denied: camera/microphone access is required for in-app calls. You can still join via Zoom.';
      emit('error', { code: 'perm_denied', error: err });
    } else {
      permissionError.value = 'Unable to access camera/microphone. Check device and browser settings.';
      emit('error', { code: 'media_unavailable', error: err });
    }
    console.error('getUserMedia failed', err);
    return false;
  }
}

/* ------------------- peer connections ------------------- */
function createPeerConnection(peerId) {
  if (pcs[peerId]) return pcs[peerId];
  const pc = new RTCPeerConnection(pcConfig);

  if (localStream.value) {
    localStream.value.getTracks().forEach(track => pc.addTrack(track, localStream.value));
  }

  pc.ontrack = (ev) => {
    const ms = (ev.streams && ev.streams[0]) ? ev.streams[0] : new MediaStream();
    if (!remoteStreams[peerId]) {
      remoteStreams[peerId] = { stream: ms, label: `peer:${peerId}` };
    } else {
      try { ev.streams[0].getTracks().forEach(t => remoteStreams[peerId].stream.addTrack(t)); } catch {}
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
    try { pc.close(); } catch {}
    delete pcs[peerId];
  }
  if (remoteStreams[peerId]) delete remoteStreams[peerId];
}

/* ------------------- socket signaling (in-app rtc) ------------------- */
socket.on('connect', () => {
  safeLog('call socket connected', socket.id);
  socket.emit('call:join', { roomId: props.roomId, userId: myId || socket.id, name: myName });
});

socket.on('call:ready', async ({ peerId, name }) => {
  if (!peerId || peerId === (myId || socket.id)) return;
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
  if (!pc) return;
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

/* ------------------- session + Zoom socket events ------------------- */
socket.on('session:meeting_link', (payload = {}) => {
  // payload.meeting.joinUrl / meta.startUrl
  try {
    const joinUrl = payload?.meeting?.joinUrl || payload?.meeting?.meta?.joinUrl || null;
    const startUrl = payload?.meeting?.meta?.startUrl || null;
    if (joinUrl || startUrl) {
      // Prefer host startUrl when isHost, else joinUrl
      const url = props.isHost ? (startUrl || joinUrl) : (joinUrl || startUrl);
      if (url) {
        joinableExternally.value = true;
        cachedZoom.joinUrl = joinUrl || cachedZoom.joinUrl || null;
        cachedZoom.startUrl = startUrl || cachedZoom.startUrl || null;
        window.open(url, '_blank');
        emit('zoom:opened', { fromSocket: true, url });
      }
    }
  } catch {}
});

socket.on('session:ended', ({ sessionId } = {}) => {
  // Ended on server → leave in-app
  if (sessionId && props.sessionId && String(sessionId) !== String(props.sessionId)) return;
  leave();
});

socket.on('session:window_open', ({ sessionId } = {}) => {
  // Optional: could pre-enable a UI flag
  if (sessionId && props.sessionId && String(sessionId) !== String(props.sessionId)) return;
  safeLog('session window opened for', sessionId || '(unknown)');
});

/* ------------------- UI controls ------------------- */
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
  try { socket.emit('call:leave', { roomId: props.roomId, userId: myId || socket.id }); } catch {}
  Object.keys(pcs).forEach(id => removePeer(id));
  if (localStream.value) {
    localStream.value.getTracks().forEach(t => { try { t.stop(); } catch {} });
    localStream.value = null;
  }
  if (localVideo.value) localVideo.value.srcObject = null;
  try { socket.disconnect(); } catch {}
  emit('left', { roomId: props.roomId });
}

/* ------------------- Zoom helpers ------------------- */
const joinableExternally = ref(!!props.externalJoinLink);
const generating = ref(false);

// cache last-known Zoom URLs from server so subsequent clicks use them
const cachedZoom = reactive({
  joinUrl: props.externalJoinLink || null,
  startUrl: null
});

function openExternal() {
  const url = props.isHost ? (cachedZoom.startUrl || cachedZoom.joinUrl || props.externalJoinLink)
                           : (cachedZoom.joinUrl || cachedZoom.startUrl || props.externalJoinLink);
  if (!url) return alert('No external link provided.');
  window.open(url, '_blank');
  emit('zoom:opened', { url, cached: true });
}

async function apiCreateOrGetZoomMeeting(sessionId) {
  // Primary route: POST /api/rtc/zoom/meeting
  try {
    const res = await fetch('/api/rtc/zoom/meeting', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {})
      },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok && data?.zoom) return data.zoom;
    // If not ok, fall through to fallback
  } catch (e) {
    console.warn('zoom/meeting failed, trying fallback', e);
  }

  // Fallback route: GET /api/sessions/:id/join (also lazily creates)
  const res2 = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/join`, {
    method: 'GET',
    headers: {
      ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {})
    }
  });
  const data2 = await res2.json().catch(() => null);
  if (!res2.ok) throw new Error(data2?.message || `HTTP ${res2.status}`);

  // normalize
  return {
    joinUrl: data2?.joinUrl || null,
    startUrl: data2?.startUrl || null
  };
}

async function generateAndOpenJoinLink() {
  if (!props.sessionId) return alert('No session id to generate link.');
  if (generating.value) return;
  generating.value = true;
  try {
    const zoom = await apiCreateOrGetZoomMeeting(props.sessionId);
    if (!zoom?.joinUrl && !zoom?.startUrl) throw new Error('No join/start URL returned');

    cachedZoom.joinUrl = zoom.joinUrl || cachedZoom.joinUrl;
    cachedZoom.startUrl = zoom.startUrl || cachedZoom.startUrl;
    joinableExternally.value = !!(cachedZoom.joinUrl || cachedZoom.startUrl);

    const url = props.isHost ? (zoom.startUrl || zoom.joinUrl) : (zoom.joinUrl || zoom.startUrl);
    if (url) {
      window.open(url, '_blank');
      emit('zoom:generated', { url, zoom });
    } else {
      alert('Server returned meeting but no URL.');
    }
  } catch (e) {
    console.error('Failed to generate Zoom link', e);
    emit('error', { code: 'join_generate_failed', error: e });
    alert(e?.message || 'Failed to generate/join Zoom meeting.');
  } finally {
    generating.value = false;
  }
}

/* ------------------- lifecycle ------------------- */
onMounted(async () => {
  // Start media (even if Zoom-only, we keep fallback alive)
  await startLocalMedia();

  // Connect socket (for both in-app rtc and session events)
  try { socket.connect(); } catch (e) { console.warn('socket connect failed', e); }

  // If we already have a Zoom link passed in, mark as joinable
  if (props.externalJoinLink) joinableExternally.value = true;
});

onBeforeUnmount(() => {
  leave();
});
</script>

<style scoped>
.call-room { padding: 12px; }
.row { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
button { padding:8px 12px; border-radius:8px; border:0; background:#1f6feb; color:white; cursor:pointer; }
button.secondary { background:#64748b; }
button.danger { background:#ef4444; }
.video-wrap { position:relative; width:100%; }
.local-video { width:100%; border-radius:10px; background:#000; height:220px; object-fit:cover; }
.perm-error { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:12px; color:white; background: linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.6)); text-align:center; border-radius:10px; }
.small { color:#94a3b8; }
.card { background:#fff; border-radius:10px; box-shadow:0 6px 18px rgba(2,6,23,0.06); }
</style>
