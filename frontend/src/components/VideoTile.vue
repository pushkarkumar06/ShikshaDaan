<template>
  <div class="video-tile" :class="{ inactive: !isActive }">
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

      <!-- Placeholder -->
      <div v-if="!hasStream" class="placeholder">
        <div class="ph-text">No video</div>
        <div class="ph-sub">Waiting for peer…</div>
      </div>

      <!-- Join overlay -->
      <div v-if="showJoinButton" class="join-overlay">
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
});

const emit = defineEmits(["toggle-mute", "toggle-video", "join", "ready"]);

const v = ref(null);
const hasStream = ref(false);

// computed status
const statusText = computed(() => {
  if (props.status) return props.status;
  if (!props.stream) return "disconnected";
  return hasStream.value ? "connected" : "connecting";
});

// attach stream
async function attachStreamToVideo(s) {
  await nextTick();
  if (!v.value) return;

  try {
    v.value.srcObject = s || null;
    hasStream.value = !!s && s.getTracks && s.getTracks().length > 0;

    // autoplay attempt
    await v.value.play().catch(() => {});
  } catch (err) {
    console.warn("attachStream failed:", err);
    try {
      v.value.srcObject = null;
    } catch {}
    hasStream.value = false;
  }
}

// loadedmetadata handler
function onLoadedMeta() {
  try {
    v.value?.play().catch(() => {});
  } catch {}
}

// watch stream prop
watch(
  () => props.stream,
  (s) => {
    attachStreamToVideo(s);
    hasStream.value = !!(s && s.getTracks && s.getTracks().length > 0);
  },
  { immediate: true }
);

// lifecycle
onMounted(() => {
  attachStreamToVideo(props.stream);
  emit("ready", { peerId: props.peerId });
});

onBeforeUnmount(() => {
  if (v.value) {
    try {
      v.value.srcObject = null;
    } catch {}
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
}
.video-tile.inactive {
  opacity: 0.85;
  filter: grayscale(0.1);
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
