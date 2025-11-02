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
  /** Scheduled start time: ISO string, ms timestamp, Date, or a local naive "YYYY-MM-DD[ T]HH:mm" */
  startAt: { type: [String, Number, Date], required: true },
  /** Optional end time (ISO/ms/Date). If not provided, use startAt + windowAfterMin */
  endAt: { type: [String, Number, Date], default: null },
  /** If true, keep counting into negative territory (overdue) */
  showOverdue: { type: Boolean, default: false },
  /** Tick interval (ms) */
  tickMs: { type: Number, default: 1000 },
  /** Minutes before start when the "join window" opens */
  windowBeforeMin: { type: Number, default: 10 },
  /** Minutes after start when the "join window" closes (if endAt not provided) */
  windowAfterMin: { type: Number, default: 60 },
});

const emit = defineEmits([
  "started",       // when we cross startAt
  "tick",          // every tick with remaining structure
  "window-open",   // when now enters [startAt - windowBeforeMin, end]
  "window-close",  // when now leaves the window
  "ended"          // when we pass endAt (or start+afterMin)
]);

const timeLeft = ref({ total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
let intervalId = null;
let reachedZero = false;
let windowIsOpen = false;
let endedEmitted = false;

/* ------------------------ utils ------------------------ */
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

function pad(n) { return String(n).padStart(2, "0"); }

/** Robust timestamp parser that preserves LOCAL time for naive date strings */
function parseTs(v) {
  // number ms or Date
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;

  if (typeof v !== "string") return null;
  const s = v.trim();

  // numeric string
  if (/^\d{8,}$/.test(s)) return Number(s);

  // local naive: "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm" or with optional seconds
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m && !/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const [, Y, M, D, h, mnt, sec] = m.map(Number);
    const dt = new Date(Y, M - 1, D, h, mnt, sec || 0, 0); // LOCAL
    const t = dt.getTime();
    return Number.isNaN(t) ? null : t;
  }

  // ISO with timezone (UTC-safe)
  const p = Date.parse(s);
  return Number.isNaN(p) ? null : p;
}

const startMs = computed(() => parseTs(props.startAt));
const explicitEndMs = computed(() => (props.endAt ? parseTs(props.endAt) : null));

/** End boundary for window/ended logic */
const windowEndMs = computed(() => {
  if (explicitEndMs.value) return explicitEndMs.value;
  if (startMs.value == null) return null;
  return startMs.value + props.windowAfterMin * 60 * 1000;
});

/** Start boundary for window logic */
const windowOpenMs = computed(() => {
  if (startMs.value == null) return null;
  return startMs.value - props.windowBeforeMin * 60 * 1000;
});

/* ------------------------ main updater ------------------------ */
function update() {
  const sMs = startMs.value;
  if (sMs == null) {
    timeLeft.value = compute(0);
    return;
  }

  const now = Date.now();
  const diffToStart = sMs - now;
  const total = props.showOverdue ? diffToStart : Math.max(0, diffToStart);

  timeLeft.value = compute(total);
  emit("tick", { ...timeLeft.value, now: new Date(now).toISOString() });

  // START reached
  if (!reachedZero && diffToStart <= 0) {
    reachedZero = true;
    emit("started", { startAt: new Date(sMs).toISOString() });
  }

  // WINDOW open/close transitions
  if (windowOpenMs.value != null && windowEndMs.value != null) {
    const inWindow = now >= windowOpenMs.value && now <= windowEndMs.value;
    if (inWindow && !windowIsOpen) {
      windowIsOpen = true;
      emit("window-open", {
        openAt: new Date(windowOpenMs.value).toISOString(),
        closeAt: new Date(windowEndMs.value).toISOString(),
      });
    } else if (!inWindow && windowIsOpen) {
      windowIsOpen = false;
      emit("window-close", { closedAt: new Date(now).toISOString() });
    }
  }

  // ENDED event
  if (windowEndMs.value != null && !endedEmitted && now > windowEndMs.value) {
    endedEmitted = true;
    emit("ended", { endAt: new Date(windowEndMs.value).toISOString() });
  }
}

/* ------------------------ lifecycle ------------------------ */
onMounted(() => {
  update();
  intervalId = setInterval(update, props.tickMs);
});

onBeforeUnmount(() => { if (intervalId) clearInterval(intervalId); });

watch(
  [() => props.startAt, () => props.endAt, () => props.windowBeforeMin, () => props.windowAfterMin],
  () => {
    // reset state on schedule changes
    reachedZero = false;
    windowIsOpen = false;
    endedEmitted = false;

    update();
    if (!intervalId) intervalId = setInterval(update, props.tickMs);
  }
);

/* ------------------------ computed strings ------------------------ */
const overdueText = computed(() => {
  if (timeLeft.value.total >= 0) return "";
  const tf = timeLeft.value;
  return `${tf.days}d ${pad(tf.hours)}:${pad(tf.minutes)}:${pad(tf.seconds)}`;
});
</script>

<style scoped>
.countdown { font-weight: 600; font-size: 1rem; color: #1f2937; }
.live { color: #10b981; }
.overdue { color: #ef4444; }
</style>
