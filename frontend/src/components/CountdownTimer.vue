<template>
  <div class="countdown" role="timer" aria-live="polite">
    <span v-if="timeLeft.total <= 0 && !showOverdue">LIVE</span>
    <span v-else-if="timeLeft.total <= 0 && showOverdue">
      LIVE (overdue {{ overdueText }})
    </span>
    <span v-else>
      <template v-if="timeLeft.days > 0">{{ timeLeft.days }}d </template>
      <template v-if="timeLeft.hours > 0">{{ pad(timeLeft.hours) }}h </template>
      <template v-if="timeLeft.minutes > 0">{{ pad(timeLeft.minutes) }}m </template>
      <span>{{ pad(timeLeft.seconds) }}s</span>
    </span>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from "vue";

const props = defineProps({
  // ISO string or timestamp in ms
  startAt: { type: [String, Number], required: true },
  // optional: show negative / overdue? default false
  showOverdue: { type: Boolean, default: false },
  tickMs: { type: Number, default: 1000 },
});

const emit = defineEmits(["started", "tick"]);

const timeLeft = ref({ total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
let intervalId = null;
let reachedZero = false;

function compute(ms) {
  const total = ms; // can be negative if showOverdue true
  const absTotal = Math.abs(Math.floor(total));
  const secondsTotal = Math.floor(absTotal / 1000);
  const days = Math.floor(secondsTotal / 86400);
  const hours = Math.floor((secondsTotal % 86400) / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  return { total, days, hours, minutes, seconds };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseStartAt() {
  if (typeof props.startAt === "number") return props.startAt;
  const p = Date.parse(props.startAt);
  return Number.isNaN(p) ? null : p;
}

function update() {
  const s = parseStartAt();
  if (s === null) {
    timeLeft.value = compute(0);
    return;
  }
  const now = Date.now();
  const diff = s - now;
  // if not showOverdue, clamp at 0
  const total = props.showOverdue ? diff : Math.max(0, diff);
  timeLeft.value = compute(total);

  // emit every tick
  emit("tick", { ...timeLeft.value });

  // when we cross to <=0, emit started once
  if (!reachedZero && diff <= 0) {
    reachedZero = true;
    emit("started", { startAt: new Date(s).toISOString() });
    if (!props.showOverdue) {
      // stop ticking to save CPU if not showing overdue
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  }
}

onMounted(() => {
  update();
  if (!intervalId) intervalId = setInterval(update, props.tickMs);
});

onBeforeUnmount(() => {
  if (intervalId) clearInterval(intervalId);
});

watch(() => props.startAt, () => {
  // reset reachedZero so if startAt changes to future we resume ticks
  reachedZero = false;
  update();
  if (!intervalId) intervalId = setInterval(update, props.tickMs);
});

const overdueText = computed(() => {
  if (timeLeft.value.total >= 0) return "";
  // compute human readable overdue (days/h:m:s)
  const tf = timeLeft.value;
  return `${tf.days}d ${pad(tf.hours)}:${pad(tf.minutes)}:${pad(tf.seconds)}`;
});
</script>

<style scoped>
.countdown {
  font-weight: 600;
  color: #1f2937;
}
</style>
