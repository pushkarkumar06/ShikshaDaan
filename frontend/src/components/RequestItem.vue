<template>
  <div class="request-card" :class="statusClass" :data-request-id="propsId">
    <div class="meta">
      <div class="header">
        <b>{{ request.fromName || request.studentName || request.requestedBy?.name || 'Unknown User' }}</b>
        <span class="status-badge">{{ formattedStatus }}</span>
      </div>

      <div class="subject" v-if="request.subject">{{ request.subject }}</div>
      <div class="small message" v-if="request.message">{{ request.message }}</div>

      <div class="session-info" v-if="nextStartAt || request.proposed || request.final">
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
      <CountdownTimer
        v-if="showCountdownComputed"
        :startAt="nextStartAt"
        :showOverdue="false"
        class="countdown-timer countdown"
        @started="onStarted"
      />
      <div v-else-if="request.status === 'completed'" class="completed-text">
        Session completed
      </div>
      <div v-else-if="request.status === 'cancelled'" class="cancelled-text">
        Session cancelled
      </div>
    </div>

    <div class="actions">
      <!-- Pending → volunteer decides -->
      <template v-if="isVolunteer && request.status === 'pending'">
        <button @click="accept" class="accept-btn">Accept</button>
        <button @click="reject" class="reject-btn">Reject</button>
      </template>

      <!-- Scheduled/Accepted → show Generate & Join within window -->
      <template v-else-if="isOwner && (request.status === 'scheduled' || request.status === 'accepted')">
        <button
          v-if="(canGenerateOrJoin || debugForceJoin)"
          @click="handleJoinClick"
          class="join-btn"
          :disabled="isJoining"
        >
          <span v-if="isJoining">Working…</span>
          <span v-else>{{ joinLabel }}</span>
        </button>

        <div v-else class="status small">
          Join window opens 10 min before session
        </div>
      </template>

      <div v-else class="status">{{ formattedStatus }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import CountdownTimer from '@/components/CountdownTimer.vue'

// Reactive timestamp that updates every second
const nowTs = ref(Date.now())
let tickInterval = null

// Update the timestamp every second
function onTick() {
  nowTs.value = Date.now()
}

// Start/stop the clock when component mounts/unmounts
onMounted(() => {
  onTick() // initial tick
  tickInterval = setInterval(onTick, 1000)
})

onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval)
})

// Handle window open event
function onWindowOpen() {
  // optional: you could prefetch the meeting link here if you want
  // e.g., call handleJoinClick() or just set a flag
}

const props = defineProps({
  request: { type: Object, required: true },
  isVolunteer: { type: Boolean, default: false },
  currentUserId: { type: [String, Number], default: '' },
  // optional auth token (if not provided, will try localStorage.token)
  authToken: { type: String, default: '' },
  // dev helpers:
  debugForceCountdown: { type: Boolean, default: false },
  debugForceJoin: { type: Boolean, default: false }
})
const emit = defineEmits(['accepted','rejected','join','started','update:request'])

const isJoining = ref(false)

// small id to make DOM selection easier
const propsId = props.request && props.request._id
  ? String(props.request._id)
  : `req-${Math.floor(Math.random()*100000)}`

// ----------------- helpers -----------------
const statusClass = computed(() => `status-${(props.request.status || 'pending')}`)

const formattedStatus = computed(() => {
  const s = props.request.status || 'pending'
  return typeof s === 'string' ? s.charAt(0).toUpperCase() + s.slice(1) : String(s)
})

// Determine if this viewer is the host (volunteer)
const isHost = computed(() => !!props.isVolunteer)

// Determine owner (student or volunteer)
const isOwner = computed(() => {
  if (!props.currentUserId) return false
  const sid = props.request.studentId || props.request.student?._id || props.request.student
  const vid = props.request.volunteerId || props.request.volunteer?._id || props.request.volunteer
  return String(sid) === String(props.currentUserId) || String(vid) === String(props.currentUserId)
})

// Build ISO start (aligned with backend logic)
function buildISOStart(r) {
  if (!r) return null
  try {
    if (r.final?.startISO) return new Date(r.final.startISO).toISOString()
    if (r.scheduledAt) return new Date(r.scheduledAt).toISOString()
    if (r.final?.date && r.final?.time) {
      const tRaw = (r.final.time || '').includes('-') ? r.final.time.split('-')[0] : (r.final.time || '00:00')
      const t = (tRaw.includes('T') ? tRaw.split('T')[1] : tRaw).substring(0,5)
      return new Date(`${r.final.date}T${t}:00.000Z`).toISOString()
    }
    if (r.startAt) return new Date(r.startAt).toISOString()
    if (r.date && r.time) {
      const tt = r.time.includes('-') ? r.time.split('-')[0] : r.time
      return new Date(`${r.date}T${tt}:00.000Z`).toISOString()
    }
    if (r.proposed?.date && r.proposed?.time) {
      const tt = (r.proposed.time.includes('-') ? r.proposed.time.split('-')[0] : r.proposed.time).substring(0,5)
      return new Date(`${r.proposed.date}T${tt}:00.000Z`).toISOString()
    }
  } catch {}
  return null
}

const nextStartAt = computed(() => buildISOStart(props.request))

// show countdown only for accepted/scheduled + nextStartAt present
const showCountdownComputed = computed(() => {
  const s = (props.request.status || '').toLowerCase()
  if (props.debugForceCountdown) return true
  return ['accepted','scheduled'].includes(s) && !!nextStartAt.value
})

// ------------- Join/Generate window (10 min before → 60 min after) -------------
const canGenerateOrJoin = computed(() => {
  if (!nextStartAt.value) return false
  const sessionTime = new Date(nextStartAt.value).getTime()
  const now = nowTs.value               // Using reactive timestamp
  const before = 10 * 60 * 1000
  const after  = 60 * 60 * 1000
  return now >= (sessionTime - before) && now <= (sessionTime + after)
})

// Format time for display
const formattedTime = computed(() => {
  try {
    if (nextStartAt.value) {
      const d = new Date(nextStartAt.value)
      if (!isNaN(d.getTime())) return d.toLocaleString()
    }
  } catch (e) {}
  if (props.request.proposed) {
    if (props.request.proposed.date || props.request.proposed.time) {
      return `${props.request.proposed.date || ''} ${props.request.proposed.time || ''}`.trim()
    }
  }
  if (props.request.final) {
    return props.request.final.date ? `${props.request.final.date} ${props.request.final.time || ''}`.trim() : '—'
  }
  return 'Time not set'
})

// Existing link presence + which URL to open
const hasAnyZoomLink = computed(() => {
  return !!(
    props.request?.zoomMeeting?.joinUrl ||
    props.request?.zoomMeeting?.startUrl ||
    props.request?.final?.zoomLink ||
    props.request?.zoomLink
  )
})

const effectiveJoinUrl = computed(() => {
  // Prefer new zoomMeeting.joinUrl; fallback to final.zoomLink/back-compat
  return (
    props.request?.zoomMeeting?.joinUrl ||
    props.request?.final?.zoomLink ||
    props.request?.zoomLink ||
    null
  )
})

const joinLabel = computed(() => {
  if (hasAnyZoomLink.value) return isHost.value ? 'Start Now' : 'Join Now'
  return 'Generate & Join'
})

// -------------------- API helpers --------------------
function getAuthToken() {
  if (props.authToken) return props.authToken
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

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
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (!res2.ok) {
    const msg = await safeJson(res2)
    throw new Error(msg?.message || `HTTP ${res2.status}`)
  }
  const data2 = await res2.json()
  // Normalize to zoomMeeting-like object
  return {
    joinUrl: data2?.joinUrl || null,
    startUrl: data2?.startUrl || null
  }
}

async function safeJson(res) {
  try { return await res.json() } catch { return null }
}

// ------------ actions ------------
function accept() {
  emit('accepted', props.request)
}

async function reject() {
  if (!props.request._id) return
  if (confirm('Reject?')) emit('rejected', props.request)
}

async function handleJoinClick() {
  if (isJoining.value) return
  isJoining.value = true
  try {
    // If we already have links, just open
    if (hasAnyZoomLink.value) {
      const url = isHost.value
        ? (props.request?.zoomMeeting?.startUrl || effectiveJoinUrl.value)
        : (effectiveJoinUrl.value)
      if (url) window.open(url, '_blank')
      emit('join', props.request)
      isJoining.value = false
      return
    }

    // Else, ask backend to create/return links
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
  } catch (e) {
    console.error('Failed to join/generate Zoom link:', e)
    alert(e?.message || 'Failed to generate/join Zoom meeting')
  } finally {
    isJoining.value = false
  }
}

function onStarted(payload) {
  emit('started', { request: props.request, payload })
}

// --------------- debug logs ----------------
onMounted(() => {
  console.log('REQDBG mount', {
    id: props.request._id || '(no id)',
    status: props.request.status,
    nextStartAt: nextStartAt.value,
    formattedTime: formattedTime.value,
    showCountdownComputed: showCountdownComputed.value,
    canGenerateOrJoin: canGenerateOrJoin.value,
    joinLabel: joinLabel.value
  })
})

watch(() => props.request, (n) => {
  console.log('REQDBG: request prop updated for', propsId, {
    id: n?._id || '(no id)',
    status: n?.status,
    nextStartAt: nextStartAt.value,
    showCountdownComputed: showCountdownComputed.value,
    canGenerateOrJoin: canGenerateOrJoin.value
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
