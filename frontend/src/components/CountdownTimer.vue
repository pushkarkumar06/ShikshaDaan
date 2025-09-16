<template>
  <div class="countdown">
    <span v-if="timeLeft.total <= 0">LIVE</span>
    <span v-else>
      <template v-if="timeLeft.days > 0">{{ timeLeft.days }}d </template>
      <template v-if="timeLeft.hours > 0">{{ pad(timeLeft.hours) }}h </template>
      <template v-if="timeLeft.minutes > 0">{{ pad(timeLeft.minutes) }}m </template>
      <span>{{ pad(timeLeft.seconds) }}s</span>
    </span>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps({
  // ISO string or timestamp in ms
  startAt: { type: [String, Number], required: true },
  // optional: show negative / overdue? default false
  showOverdue: { type: Boolean, default: false },
  tickMs: { type: Number, default: 1000 },
});

const timeLeft = ref({ total: 0, days:0, hours:0, minutes:0, seconds:0 });

let intervalId = null;

function compute(ms) {
  const total = Math.max(0, Math.floor(ms));
  const secondsTotal = Math.floor(total / 1000);
  const days = Math.floor(secondsTotal / 86400);
  const hours = Math.floor((secondsTotal % 86400) / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  return { total, days, hours, minutes, seconds };
}

function pad(n){ return String(n).padStart(2, '0'); }

function update() {
  const s = typeof props.startAt === 'string' ? Date.parse(props.startAt) : Number(props.startAt);
  const now = Date.now();
  const diff = s - now;
  if (diff <= 0) {
    timeLeft.value = compute(0);
    if (props.showOverdue) {
      // optional: negative countdown not shown here. Keep as LIVE when <= 0
    }
  } else {
    timeLeft.value = compute(diff);
  }
}

onMounted(() => {
  update();
  intervalId = setInterval(update, props.tickMs);
});

onBeforeUnmount(() => {
  if (intervalId) clearInterval(intervalId);
});

watch(() => props.startAt, () => update());
</script>

<style scoped>
.countdown{ font-weight:600; color:#1f2937; }
</style>
