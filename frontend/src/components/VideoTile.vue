<template>
  <div class="video-tile">
    <div class="label-row" style="display:flex; justify-content:space-between; width:100%; align-items:center;">
      <div class="label">{{ label }}</div>
      <div class="controls" v-if="showControls" style="display:flex; gap:6px; align-items:center;">
        <button class="ctrl" @click="$emit('toggle-mute')">{{ muted ? 'Unmute' : 'Mute' }}</button>
        <button class="ctrl" @click="$emit('toggle-video')">{{ videoEnabled ? 'Video Off' : 'Video On' }}</button>
      </div>
    </div>
    <video ref="v" autoplay playsinline :muted="muted" class="video-el"></video>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  stream: { type: Object, default: null },
  label: { type: String, default: "" },
  muted: { type: Boolean, default: false },
  showControls: { type: Boolean, default: false },
  videoEnabled: { type: Boolean, default: true },
});

const emit = defineEmits(["toggle-mute", "toggle-video"]);

const v = ref(null);

onMounted(() => {
  if (v.value && props.stream) v.value.srcObject = props.stream;
});

watch(
  () => props.stream,
  (s) => {
    if (v.value) {
      v.value.srcObject = s || null;
    }
  }
);

onBeforeUnmount(() => {
  if (v.value) v.value.srcObject = null;
});
</script>

<style scoped>
.video-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  width: 100%;
}
.label {
  font-size: 0.95em;
  color: #0f1724;
  font-weight: 600;
}
.label-row .label {
  color: #0f1724;
}
.video-el {
  width: 100%;
  max-width: 420px;
  height: 240px;
  border-radius: 8px;
  background: #000;
  object-fit: cover;
  border: 1px solid #e2e8f0;
}
.controls .ctrl {
  padding: 6px 8px;
  background: #e2e8f0;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.controls .ctrl:hover {
  background: #cbd5e1;
}
</style>
