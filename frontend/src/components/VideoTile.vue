<template>
  <div
    class="video-tile"
    :class="{ inactive: !isActive, ended: ended }"
    :aria-label="ariaLabel"
  >
    <!-- Header -->
    <div class="label-row">
      <div class="label">
        {{ label || (peerId ? `peer:${peerId}` : "Participant") }}
      </div>

      <div class="right-controls">
        <div class="status" v-if="statusText">{{ statusText }}</div>
        <div class="controls" v-if="showControls">
          <button class="ctrl" @click="$emit('toggle-mute')">
            {{ muted ? "Unmute" : "Mute" }}
          </button>
          <button class="ctrl" @click="$emit('toggle-video')">
            {{ videoEnabled ? "Video Off" : "Video On" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Video -->
    <div class="video-wrap">
      <video
        ref="v"
        autoplay
        playsinline
        :muted="muted"
        class="video-el"
        @loadedmetadata="onLoadedMeta"
      ></video>

      <!-- Overlays / placeholders -->
      <div v-if="ended" class="ended-overlay">Session ended</div>

      <div v-else-if="!hasAnyTrack" class="placeholder">
        <div class="ph-text">No media</div>
        <div class="ph-sub">Waiting for peer…</div>
      </div>

      <div v-else-if="!hasVideoTrack" class="placeholder">
        <div class="ph-text">Audio only</div>
        <div class="ph-sub">Peer is connected</div>
      </div>

      <!-- Join overlay (optional button from parent) -->
      <div v-if="showJoinButton && !ended" class="join-overlay">
        <button class="join-btn" @click="$emit('join')">Join / Open</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from "vue";

const props = defineProps({
  stream: { type: Object, default: null },         // MediaStream from remote
  label: { type: String, default: "" },            // Display name
  peerId: { type: String, default: "" },           // Optional peer identifier
  muted: { type: Boolean, default: false },        // Mute audio playback
  showControls: { type: Boolean, default: false }, // Show mute/video controls
  videoEnabled: { type: Boolean, default: true },  // Expect video stream
  isActive: { type: Boolean, default: true },      // Mark active/inactive
  showJoinButton: { type: Boolean, default: false }, // Show "Join" button
  status: { type: String, default: "" },           // Status (connecting/connected)
  ended: { type: Boolean, default: false },        // NEW: marks session as ended (UI dim)
});

const emit = defineEmits(["toggle-mute", "toggle-video", "join", "ready"]);

const v = ref(null);
const hasVideoTrack = ref(false);
const hasAudioTrack = ref(false);

const hasAnyTrack = computed(() => hasVideoTrack.value || hasAudioTrack.value);

const ariaLabel = computed(() => {
  const base = props.label || (props.peerId ? `peer:${props.peerId}` : "participant");
  return `${base} ${statusText.value}`;
});

// computed status
const statusText = computed(() => {
  if (props.ended) return "ended";
  if (props.status) return props.status;
  if (!props.stream) return "disconnected";
  return hasAnyTrack.value ? "connected" : "connecting";
});

// attach stream to video
async function attachStreamToVideo(s) {
  await nextTick();
  if (!v.value) return;

  try {
    v.value.srcObject = s || null;
    detectTracks(s);

    // Try to play (autoplay policy safe)
    if (s) {
      await v.value.play().catch(() => {
        // Some browsers require a user gesture; ignore silently.
      });
    }
  } catch (err) {
    console.warn("attachStream failed:", err);
    try { v.value.srcObject = null; } catch {}
    hasVideoTrack.value = false;
    hasAudioTrack.value = false;
  }
}

// detect available tracks
function detectTracks(s) {
  try {
    const vids = s?.getVideoTracks?.() || [];
    const auds = s?.getAudioTracks?.() || [];
    hasVideoTrack.value = vids.some(t => t.readyState !== "ended");
    hasAudioTrack.value = auds.some(t => t.readyState !== "ended");
  } catch {
    hasVideoTrack.value = false;
    hasAudioTrack.value = false;
  }
}

// loadedmetadata handler
function onLoadedMeta() {
  try { v.value?.play().catch(() => {}); } catch {}
}

// watch stream prop
watch(
  () => props.stream,
  (s, prev) => {
    // detach listeners from previous tracks
    if (prev && prev.getTracks) {
      prev.getTracks().forEach(t => { try { t.onended = null; t.onmute = null; t.onunmute = null; } catch {} });
    }

    attachStreamToVideo(s);

    // react to track lifecycle
    if (s && s.getTracks) {
      s.getTracks().forEach(t => {
        try {
          t.onended = () => detectTracks(s);
          t.onmute = () => detectTracks(s);
          t.onunmute = () => detectTracks(s);
        } catch {}
      });
    }
  },
  { immediate: true }
);

// keep the video element's muted attr in sync (helps some browsers)
watch(() => props.muted, (m) => {
  if (v.value) v.value.muted = !!m;
});

// lifecycle
onMounted(() => {
  attachStreamToVideo(props.stream);
  emit("ready", { peerId: props.peerId });
});

onBeforeUnmount(() => {
  if (v.value) {
    try { v.value.srcObject = null; } catch {}
  }
});
</script>

<style scoped>
.video-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  transition: opacity .2s ease, filter .2s ease;
}
.video-tile.inactive {
  opacity: 0.85;
  filter: grayscale(0.1);
}
.video-tile.ended {
  opacity: 0.6;
  filter: grayscale(0.2);
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.label {
  font-size: 0.95em;
  font-weight: 600;
  color: #0f1724;
}
.right-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status {
  font-size: 0.8rem;
  color: #64748b;
  padding: 4px 8px;
  border-radius: 6px;
  background: #f3f4f6;
}

.video-wrap {
  position: relative;
  width: 100%;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-el {
  width: 100%;
  height: 240px;
  max-height: 360px;
  object-fit: cover;
  display: block;
  background: #000;
  border: 1px solid #e2e8f0;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  color: #cbd5e1;
  background: rgba(2, 6, 23, 0.2);
  pointer-events: none;
}
.ph-text {
  font-weight: 700;
  font-size: 1.05rem;
}
.ph-sub {
  font-size: 0.9rem;
  color: #94a3b8;
}

.ended-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f1f5f9;
  background: rgba(2, 6, 23, 0.55);
  font-weight: 700;
  font-size: 1.05rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.join-overlay {
  position: absolute;
  bottom: 10px;
  right: 10px;
}
.join-btn {
  padding: 8px 12px;
  border-radius: 8px;
  border: 0;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}
.join-btn:hover {
  background: #1e40af;
}

.controls {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ctrl {
  padding: 6px 8px;
  background: #e2e8f0;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.ctrl:hover {
  background: #cbd5e1;
}
</style>
