<template>
  <div class="request-card" :class="statusClass" :data-request-id="requestId">
    <div class="meta">
      <div class="header">
        <b>{{ request.fromName || request.studentName || request.requestedBy?.name || 'Unknown User' }}</b>
        <span class="status-badge">{{ formattedStatus }}</span>
      </div>

      <div class="subject" v-if="request.subject">{{ request.subject }}</div>
      <div class="small message" v-if="request.message">{{ request.message }}</div>

      <div class="session-info" v-if="startMs || request.proposed || request.final">
        <div class="time">
          <i class="icon">⏰</i>
          {{ formattedTime }}
        </div>

        <!-- Existing Zoom link or already-created meeting -->
        <div v-if="hasAnyZoomLink" class="zoom-link">
          <a
            v-if="isHost && request.zoomMeeting?.startUrl"
            :href="request.zoomMeeting.startUrl"
            target="_blank"
            class="zoom-button"
          >
            Start Meeting
          </a>
          <a
            v-else
            :href="effectiveJoinUrl"
            target="_blank"
            class="zoom-button"
          >
            Join Meeting
          </a>
        </div>
      </div>
    </div>

    <div class="when">
      <!-- Timer: hide when expired -->
      <CountdownTimer
        v-if="showCountdownComputed && !isExpiredNow"
        :start-at="startMs"
        :end-at="endMs"
        :show-overdue="false"
        class="countdown-timer countdown"
        @started="onStarted"
        @ended="onEnded"
      />
      <div v-else-if="isExpiredNow" class="completed-text">Session expired</div>
      <div v-else-if="request.status === 'completed'" class="completed-text">
        Session completed
      </div>
      <div v-else-if="request.status === 'expired'" class="completed-text" style="color:#9ca3af">
        Session expired
      </div>
      <div v-else-if="request.status === 'cancelled'" class="cancelled-text">
        <div v-if="request.cancelledBy">
          Cancelled by {{ request.cancelledBy === currentUserId ? 'you' : 'the other participant' }}
          <div v-if="request.cancelledAt" class="small">
            {{ new Date(request.cancelledAt).toLocaleString() }}
          </div>
        </div>
        <div v-else>
          Session cancelled
        </div>
      </div>
    </div>

    <div class="actions">
      <!-- Buttons visible to EITHER participant when status is pending -->
      <template
        v-if="currentUserId && request.status === 'pending' &&
              (String(currentUserId) === String(request.volunteer?._id || request.volunteer) ||
               String(currentUserId) === String(request.student?._id || request.student))">
        <button @click="accept" class="primary">Accept</button>
        <button @click="reject" class="danger">Reject</button>
      </template>

      <!-- Accepted/Scheduled → show Generate & Join within window, hide when expired -->
      <template v-else-if="isOwner && (request.status === 'accepted' || request.status === 'scheduled')">
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <!-- If a link already exists: Start/Join -->
          <button
            v-if="hasAnyZoomLink && !isExpired"
            @click="handleJoinClick"
            class="primary"
          >
            <span v-if="isJoining">Working…</span>
            <span v-else>{{ joinLabel }}</span>
          </button>

          <!-- At T=0 (countdown 'started') & no link yet: Generate & Join -->
          <button
            v-else-if="canGenerateNow && !hasAnyZoomLink && !isExpired"
            @click="handleJoinClick"
            class="primary"
          >
            <span v-if="isJoining">Working…</span>
            <span v-else>Generate &amp; Join</span>
          </button>

          <!-- Pre-window hint (keep if you like) -->
          <div v-else-if="!hasAnyZoomLink && !isExpired" class="status small">
            Join becomes available at start time
          </div>

          <!-- Cancel Session -->
          <button
            v-if="isOwner && ['accepted', 'scheduled'].includes(request.status) && !isExpired"
            class="reject-btn"
            @click="onCancel"
          >
            Cancel Session
          </button>
        </div>
      </template>

      <div v-else class="status">{{ formattedStatus }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import CountdownTimer from './CountdownTimer.vue'
import { localDateTimeToIso } from '../utils/datetime'

/* ===== Props / Emits FIRST ===== */
const props = defineProps({
  request: { type: Object, required: true },
  isVolunteer: { type: Boolean, default: false },
  currentUserId: { type: [String, Number], default: '' },
  authToken: { type: String, default: '' },
  // dev helpers:
  debugForceCountdown: { type: Boolean, default: false },
  debugForceJoin: { type: Boolean, default: false }
})
const emit = defineEmits(['accepted', 'rejected', 'cancel', 'join', 'started', 'update:request'])

/* ===== Reactive clock (for join window) ===== */
const nowTs = ref(Date.now())
let tickInterval = null
function onTick() { nowTs.value = Date.now() }
onMounted(() => {
  onTick();
  tickInterval = setInterval(onTick, 1000);
  // presence: LEAVE on tab close
  window.addEventListener('beforeunload', () => {
    if (props.request && props.request._id) {
      try {
        navigator.sendBeacon(
          `/api/sessions/${encodeURIComponent(props.request._id)}/presence`,
          JSON.stringify({ action: 'leave' })
        );
      } catch (_) {}
    }
  });
});
onUnmounted(() => { if (tickInterval) clearInterval(tickInterval) })

/* ===== Utilities ===== */
function toLocalMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const base = String(timeStr).split('-')[0].trim() // supports "HH:mm-HH:mm"
  const [Y, M, D] = String(dateStr).split('-').map(Number)
  const [h, m] = base.split(':').map(Number)
  const dt = new Date(Y, M - 1, D, h, m, 0, 0)       // LOCAL time
  const t = dt.getTime()
  return Number.isNaN(t) ? null : t
}

/* ===== Start time (ms) — always LOCAL, number ===== */
const startMs = computed(() => {
  const r = props.request || {}

  // 1) scheduledAt from server (string/number)
  if (r.scheduledAt) {
    const t = new Date(r.scheduledAt).getTime()
    if (!Number.isNaN(t)) return t
  }

  // 2) final {date,time}
  if (r.final?.date && r.final?.time) {
    const t = toLocalMs(r.final.date, r.final.time)
    if (t != null) return t
  }

  // 3) normalized startAt already a number
  if (typeof r.startAt === 'number') return r.startAt

  // 4) initial {date,time}
  if (r.date && r.time) {
    const t = toLocalMs(r.date, r.time)
    if (t != null) return t
  }

  // 5) proposed {date,time} (fallback display)
  if (r.proposed?.date && r.proposed?.time) {
    const t = toLocalMs(r.proposed.date, r.proposed.time)
    if (t != null) return t
  }

  return null
})

/* ===== Helpers right after startMs as requested ===== */
// duration (minutes) from explicit range, final.durationMinutes, or fallback 30
const durationMin = computed(() => {
  const r = props.request || {};
  // parse "HH:mm-HH:mm"
  const range = r?.final?.time || r?.proposed?.time || r?.time || "";
  const [s, e] = String(range).split("-").map(t => t?.trim());
  if (s && e) {
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    const diff = end - start;
    if (Number.isFinite(diff) && diff > 0) return diff;
  }
  if (Number.isFinite(r?.final?.durationMinutes) && r.final.durationMinutes > 0) {
    return r.final.durationMinutes;
  }
  return 30; // default
});

// absolute end timestamp in local time
const endMs = computed(() => {
  if (!startMs.value) return null;
  return startMs.value + durationMin.value * 60 * 1000;
});

/* ===== Basic card bindings ===== */
const request = computed(() => props.request)
const requestId = computed(() =>
  props.request && props.request._id
    ? String(props.request._id)
    : `req-${Math.floor(Math.random() * 100000)}`
)

const statusClass = computed(() => `status-${(props.request.status || 'pending')}`)

const formattedStatus = computed(() => {
  const s = props.request.status || 'pending'
  return typeof s === 'string' ? s.charAt(0).toUpperCase() + s.slice(1) : String(s)
})

const isHost = computed(() => !!props.isVolunteer)

const isOwner = computed(() => {
  if (!props.currentUserId) return false
  const sid = props.request.studentId || props.request.student?._id || props.request.student
  const vid = props.request.volunteerId || props.request.volunteer?._id || props.request.volunteer
  return String(sid) === String(props.currentUserId) || String(vid) === String(props.currentUserId)
})

/* ===== Countdown + Join window ===== */
const showCountdownComputed = computed(() => {
  const s = (props.request.status || '').toLowerCase()
  if (props.debugForceCountdown) return true
  return ['accepted', 'scheduled'].includes(s) && !!startMs.value
})

/* ===== Replaced canGenerateOrJoin to match backend window (1 min before → slot end) ===== */
const canGenerateOrJoin = computed(() => {
  if (!startMs.value) return false;
  const sessionTime = startMs.value;

  // Use the slot duration if present; otherwise fall back to 30
  const durMin = (props.request?.final?.durationMinutes && props.request.final.durationMinutes > 0)
    ? props.request.final.durationMinutes
    : 30;

  const now = nowTs.value;
  const openFrom = sessionTime - 1 * 60 * 1000;            // 1 minute before
  const closeAt  = sessionTime + durMin * 60 * 1000;       // at slot end

  return now >= openFrom && now <= closeAt;
});

/* ===== Expired-now guard for UI ===== */
const isExpiredNow = computed(() => {
  if (!endMs.value) return false;
  return nowTs.value > endMs.value;
});

/* ===== Small helper: are we past the slot end? (keeps Generate hidden if expired) ===== */
const isExpired = computed(() => {
  const start = startMs.value
  if (!start) return false
  const durMin = props.request?.final?.durationMinutes ?? 30
  return Date.now() > (start + durMin * 60 * 1000)
})

/* ===== Generate-now flag and joining state ===== */
const isJoining = ref(false)
const canGenerateNow = ref(false) // new flag that flips when countdown hits zero

/* ===== Time formatting ===== */
function to12h(hhmm = "") {
  const [hStr, mStr] = String(hhmm).split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
function formatTimeRange(range = "") {
  const [start, end] = String(range).split("-");
  if (!start) return range;
  if (!end) return to12h(start);
  return `${to12h(start)} – ${to12h(end)}`;
}

const formattedTime = computed(() => {
  try {
    const formatDateLocal = (dateStr) => {
      const [y, m, d] = String(dateStr).split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    };

    if (props.request?.final?.date && props.request?.final?.time) {
      return `${formatDateLocal(props.request.final.date)} — ${formatTimeRange(props.request.final.time)}`;
    }
    if (props.request?.proposed?.date && props.request?.proposed?.time) {
      return `${formatDateLocal(props.request.proposed.date)} — ${formatTimeRange(props.request.proposed.time)}`;
    }
    if (props.request?.date && props.request?.time) {
      return `${formatDateLocal(props.request.date)} — ${formatTimeRange(props.request.time)}`;
    }
    if (startMs.value) {
      const d = new Date(startMs.value);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
  } catch (e) {
    console.warn('Error formatting time:', e);
  }
  return "Time not set";
});

/* ===== Zoom link helpers ===== */
const hasAnyZoomLink = computed(() => {
  return !!(
    props.request?.zoomMeeting?.joinUrl ||
    props.request?.zoomMeeting?.startUrl ||
    props.request?.final?.zoomLink ||
    props.request?.zoomLink
  )
})
const effectiveJoinUrl = computed(() => {
  return (
    props.request?.zoomMeeting?.joinUrl ||
    props.request?.final?.zoomLink ||
    props.request?.zoomLink ||
    null
  )
})
const joinLabel = computed(() => {
  if (hasAnyZoomLink.value || canGenerateOrJoin.value) return isHost.value ? 'Start Now' : 'Join Now'
  return 'Generate & Join'
})

/* ===== API helpers ===== */
function getAuthToken() {
  if (props.authToken) return props.authToken
  try { return localStorage.getItem('token') || '' } catch { return '' }
}
async function safeJson(res) { try { return await res.json() } catch { return null } }

async function apiCreateOrGetZoomMeeting(sessionId) {
  // Primary: POST /api/rtc/zoom/meeting
  try {
    const token = getAuthToken()
    const res = await fetch('/api/rtc/zoom/meeting', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ sessionId })
    })
    if (!res.ok) {
      const msg = await safeJson(res)
      throw new Error(msg?.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    if (data?.ok && data?.zoom) return data.zoom
  } catch (e) {
    console.warn('zoom/meeting failed, will try sessions/:id/join fallback', e?.message || e)
  }

  // Fallback: GET /api/sessions/:id/join (also lazily creates)
  const token = getAuthToken()
  const res2 = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/join`, {
    method: 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  })
  if (!res2.ok) {
    const msg = await safeJson(res2)
    throw new Error(msg?.message || `HTTP ${res2.status}`)
  }
  const data2 = await res2.json()
  return {
    joinUrl: data2?.joinUrl || null,
    startUrl: data2?.startUrl || null
  }
}

/* ===== Actions ===== */

// accept / reject / onCancel unchanged
async function accept() {
  const id = props.request?._id || props.request?.id;
  if (!id) return alert('Missing request id');

  // decide which slot to use (final > proposed > initial)
  const dateStr =
    props.request?.final?.date ||
    props.request?.proposed?.date ||
    props.request?.date;
  const timeStr =
    props.request?.final?.time ||
    props.request?.proposed?.time ||
    props.request?.time;

  // Build scheduledAt (ISO) from local date+time (e.g. "2025-10-15" & "09:00–09:30")
  const dt = dateStr && timeStr ? localDateTimeToIso(dateStr, timeStr) : null;
  if (!dt) {
    alert('Provide scheduledAt or final {date,time}');
    return;
  }

  const payload = {
    scheduledAt: dt.iso,
    final: { date: dateStr, time: timeStr },
    tzOffsetMin: new Date().getTimezoneOffset(),
  };

  const token = localStorage.getItem('token') || '';
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Accept failed', res.status, txt);
    alert(`Accept failed (${res.status})`);
    return;
  }

  const updated = await res.json();
  emit('update:request', updated);
}

async function reject() {
  if (!props.request._id) return
  if (confirm('Reject?')) emit('rejected', props.request)
}

async function onCancel() {
  if (!props.request?._id) return;
  const ok = confirm("Cancel this session for everyone?");
  if (!ok) return;
  emit('cancel', props.request);
}

async function handleJoinClick() {
  if (isJoining.value) return
  isJoining.value = true
  try {
    // If we already have links (or we are within the window and backend will lazily create):
    if (hasAnyZoomLink.value && !props.debugForceJoin) {
      const url = isHost.value
        ? (props.request?.zoomMeeting?.startUrl || effectiveJoinUrl.value)
        : (effectiveJoinUrl.value)
      if (url) window.open(url, '_blank')
      emit('join', props.request)
      // presence: JOIN
      try {
        await fetch(`/api/sessions/${encodeURIComponent(props.request._id)}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(props.authToken ? { Authorization: `Bearer ${props.authToken}` } : {}) },
          body: JSON.stringify({ action: 'join' })
        });
      } catch (_) {}
      isJoining.value = false
      return
    }

    // Else, create/return links
    const zoom = await apiCreateOrGetZoomMeeting(props.request._id || props.request.id)
    if (!zoom?.joinUrl && !zoom?.startUrl) {
      throw new Error('No join/start URL returned')
    }

    // Merge into local request (so UI updates without refetch)
    const merged = {
      ...props.request,
      zoomMeeting: {
        ...(props.request.zoomMeeting || {}),
        ...zoom
      },
      final: {
        ...(props.request.final || {}),
        zoomLink: zoom.joinUrl || props.request?.final?.zoomLink || null
      },
      status: props.request.status === 'accepted' ? 'scheduled' : props.request.status
    }
    emit('update:request', merged)

    const openUrl = isHost.value ? (zoom.startUrl || zoom.joinUrl) : (zoom.joinUrl || zoom.startUrl)
    if (openUrl) window.open(openUrl, '_blank')
    emit('join', merged)
    // presence: JOIN
    try {
      await fetch(`/api/sessions/${encodeURIComponent(props.request._id)}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(props.authToken ? { Authorization: `Bearer ${props.authToken}` } : {}) },
        body: JSON.stringify({ action: 'join' })
      });
    } catch (_) {}
  } catch (e) {
    console.error('Failed to join/generate Zoom link:', e)
    alert(e?.message || 'Failed to generate/join Zoom meeting')
  } finally {
    isJoining.value = false
  }
}

/* ===== Make sure your CountdownTimer emits hook sets the flag ===== */
function onStarted(payload) {
  // Timer hit zero — allow generation if there is no link yet
  canGenerateNow.value = !hasAnyZoomLink.value
  emit('started', { request: props.request, payload })
}

async function onEnded() {
  // Mark as expired immediately when timer ends.
  const merged = { ...props.request, status: 'expired' };
  emit('update:request', merged);
  // Tell backend (safe if scheduler will also do it)
  try {
    await fetch(`/api/sessions/${encodeURIComponent(props.request._id)}/expire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(props.authToken ? { Authorization: `Bearer ${props.authToken}` } : {}) },
    });
  } catch (_) {}
}

/* ===== Debug logs ===== */
onMounted(() => {
  console.log('REQDBG mount', {
    id: props.request._id || '(no id)',
    status: props.request.status,
    startMs: startMs.value,
    endMs: endMs.value,
    formattedTime: formattedTime.value,
    showCountdownComputed: showCountdownComputed.value,
    canGenerateOrJoin: canGenerateOrJoin.value,
    canGenerateNow: canGenerateNow.value,
    isExpiredNow: isExpiredNow.value,
    isExpired: isExpired.value,
    joinLabel: joinLabel.value
  })
})

watch(() => props.request, (n) => {
  console.log('REQDBG: request prop updated for', requestId.value, {
    id: n?._id || '(no id)',
    status: n?.status,
    startMs: startMs.value,
    endMs: endMs.value,
    showCountdownComputed: showCountdownComputed.value,
    canGenerateOrJoin: canGenerateOrJoin.value,
    canGenerateNow: canGenerateNow.value,
    isExpiredNow: isExpiredNow.value,
    isExpired: isExpired.value
  })
}, { deep: true })
</script>

<style scoped>
/* (same styles as before) */
.request-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  margin-bottom: 1rem;
  background-color: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: all 0.2s ease;
  flex-wrap: wrap;
  gap: 1rem;
}

.request-card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
.request-card.status-pending { border-left: 4px solid #f59e0b; }
.request-card.status-accepted { border-left: 4px solid #3b82f6; }
.request-card.status-scheduled { border-left: 4px solid #10b981; }
.request-card.status-completed { border-left: 4px solid #6b7280; opacity: 0.8; }
.request-card.status-cancelled, .request-card.status-rejected { border-left: 4px solid #ef4444; opacity: 0.7; }
.meta { flex: 1; min-width: 0; }
.meta .header { display:flex; align-items:center; gap:0.75rem; margin-bottom:0.5rem; }
.status-badge { font-size: 0.75rem; font-weight:600; padding:0.25rem 0.5rem; border-radius:9999px; background:#f3f4f6; color:#4b5563; }
.subject { font-weight:600; color:#1f2937; margin-bottom:0.5rem; font-size:1.1rem; }
.message { color:#4b5563; margin:0.5rem 0; white-space:pre-wrap; word-break:break-word; line-height:1.5; }
.session-info { margin-top:0.75rem; padding-top:0.75rem; border-top:1px dashed #e5e7eb; }
.session-info .time { display:flex; align-items:center; gap:0.5rem; color:#4b5563; margin-bottom:0.5rem; font-size:0.95rem; }
.zoom-link { margin-top:0.5rem; }
.zoom-button { display:inline-block; background:#2d8cff; color:white; font-size:0.875rem; font-weight:500; padding:0.5rem 1rem; border-radius:0.5rem; text-decoration:none; transition:background-color 0.2s; text-align:center; }
.zoom-button:hover { background:#0c6fe4; color:white; }
.when { margin:0; text-align:center; min-width:180px; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:0.5rem; }
.countdown-timer { font-weight:600; color:#10b981; font-size:1.1rem; padding:0.5rem 1rem; background:#f0fdf4; border-radius:0.5rem; min-width:160px; text-align:center; }
.completed-text { color:#6b7280; font-style:italic; font-size:0.95rem; }
.cancelled-text { color:#ef4444; font-style:italic; font-size:0.95rem; }
.actions { display:flex; flex-direction:column; gap:0.5rem; min-width:120px; justify-content:center; align-self:center; }
button { padding:0.5rem 1rem; border-radius:0.5rem; font-weight:500; font-size:0.875rem; cursor:pointer; transition:all 0.2s; display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; border:1px solid transparent; }
button:disabled { opacity:0.6; cursor:not-allowed; }
.accept-btn { background:#10b981; color:white; border-color:#10b981; }
.accept-btn:hover:not(:disabled){ background:#0d9f6e; transform:translateY(-1px); }
.reject-btn { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
.reject-btn:hover:not(:disabled) { background:#fee2e2; transform:translateY(-1px); }
.join-btn { background:#3b82f6; color:white; border-color:#3b82f6; width:100%; font-weight:600; }
.join-btn:hover:not(:disabled) { background:#2563eb; transform:translateY(-1px); }
.status { color:#4b5563; font-size:0.875rem; font-weight:500; text-align:center; padding:0.5rem; border-radius:0.375rem; background:#f9fafb; width:100%; }
.small { font-size:0.875rem; color:#6b7280; line-height:1.5; margin:0; }
@media (max-width:768px) {
  .request-card { flex-direction:column; align-items:stretch; gap:1rem; padding:1rem; }
  .when { margin:0.5rem 0; text-align:left; align-items:flex-start; width:100%; }
  .actions { width:100%; margin-top:0.5rem; }
  button { width:100%; }
  .countdown-timer { width:100%; text-align:left; justify-content:flex-start; }
}
@keyframes fadeIn { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
.request-card { animation: fadeIn 0.3s ease-out; }
</style>
