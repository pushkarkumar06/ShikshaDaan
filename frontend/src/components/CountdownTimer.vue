<template>
  <div class="countdown" role="timer" aria-live="polite">
    <!-- When time is up -->
    <span v-if="timeLeft.total <= 0 && !showOverdue" class="live">LIVE</span>

    <!-- When time is overdue -->
    <span v-else-if="timeLeft.total <= 0 && showOverdue" class="live overdue">
      LIVE ({{ overdueText }} ago)
    </span>

    <!-- Normal countdown -->
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
  // Scheduled start time: ISO string or ms timestamp
  startAt: { type: [String, Number, Date], required: true },
  // If true, continue ticking even after overdue
  showOverdue: { type: Boolean, default: false },
  // Tick interval (ms)
  tickMs: { type: Number, default: 1000 },
});

const emit = defineEmits(["started", "tick"]);

const timeLeft = ref({ total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
let intervalId = null;
let reachedZero = false;

function compute(ms) {
  const total = ms;
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
  if (props.startAt instanceof Date) return props.startAt.getTime();
  if (typeof props.startAt === "number") return props.startAt;
  const p = Date.parse(props.startAt);
  return Number.isNaN(p) ? null : p;
}

function update() {
  const startMs = parseStartAt();
  if (startMs === null) {
    timeLeft.value = compute(0);
    return;
  }

  const now = Date.now();
  const diff = startMs - now;
  const total = props.showOverdue ? diff : Math.max(0, diff);

  timeLeft.value = compute(total);

  emit("tick", { ...timeLeft.value });

  if (!reachedZero && diff <= 0) {
    reachedZero = true;
    emit("started", { startAt: new Date(startMs).toISOString() });
    if (!props.showOverdue && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
}

onMounted(() => {
  update();
  intervalId = setInterval(update, props.tickMs);
});

onBeforeUnmount(() => {
  if (intervalId) clearInterval(intervalId);
});

watch(() => props.startAt, () => {
  reachedZero = false;
  update();
  if (!intervalId) intervalId = setInterval(update, props.tickMs);
});

const overdueText = computed(() => {
  if (timeLeft.value.total >= 0) return "";
  const tf = timeLeft.value;
  return `${tf.days}d ${pad(tf.hours)}:${pad(tf.minutes)}:${pad(tf.seconds)}`;
});
</script>

<style scoped>
.countdown {
  font-weight: 600;
  font-size: 1rem;
  color: #1f2937;
}

.live {
  color: #10b981;
}

.overdue {
  color: #ef4444;
}
</style>
