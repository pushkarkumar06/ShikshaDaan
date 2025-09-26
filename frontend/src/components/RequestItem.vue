<template>
  <div class="request-card" :class="statusClass">
    <div class="meta">
      <div class="header">
        <b>{{ request.fromName || request.studentName || request.requestedBy?.name || 'Unknown User' }}</b>
        <span class="status-badge">{{ formattedStatus }}</span>
      </div>

      <div class="subject" v-if="request.subject">{{ request.subject }}</div>
      <div class="small message" v-if="request.message">{{ request.message }}</div>

      <!-- Session info -->
      <div class="session-info" v-if="nextStartAt || request.final?.date || request.startAt">
        <div class="time">
          <i class="icon">⏰</i>
          {{ formattedTime }}
        </div>

        <!-- If link already exists -->
        <div v-if="request.final?.zoomLink || request.zoomLink" class="zoom-link">
          <a
            :href="request.final?.zoomLink || request.zoomLink"
            target="_blank"
            class="zoom-button"
          >
            Join Meeting
          </a>
        </div>

        <!-- If no link yet, show "Generate & Join" button -->
        <div
          v-else-if="isOwner && (request.status === 'scheduled' || request.status === 'accepted')"
          class="zoom-link"
        >
          <button
            class="zoom-button"
            :disabled="joining || !canJoinSession"
            @click="generateAndJoin"
          >
            <span v-if="joining">Generating…</span>
            <span v-else>Generate & Join</span>
          </button>
          <div v-if="!canJoinSession" class="small" style="margin-top:6px">
            Join window opens 15 minutes before session
          </div>
        </div>
      </div>
    </div>

    <!-- Countdown or status -->
    <div class="when">
      <CountdownTimer
        v-if="showCountdown"
        :startAt="nextStartAt"
        :showOverdue="false"
        class="countdown-timer"
        @started="onStarted"
      />
      <div v-else-if="request.status === 'completed'" class="completed-text">
        Session completed
      </div>
      <div v-else-if="request.status === 'cancelled'" class="cancelled-text">
        Session cancelled
      </div>
    </div>

    <!-- Action buttons -->
    <div class="actions">
      <!-- Volunteer can accept/reject pending -->
      <template v-if="isVolunteer && request.status === 'pending'">
        <button @click="accept" class="accept-btn">Accept</button>
        <button @click="reject" class="reject-btn">Reject</button>
      </template>

      <!-- Owner can join -->
      <template v-else-if="isOwner && (request.status === 'scheduled' || request.status === 'accepted')">
        <button
          v-if="(request.final?.zoomLink || request.zoomLink) || (!request.final?.zoomLink && canJoinSession)"
          @click="joinHandler"
          :disabled="joining"
          class="join-btn"
        >
          <span v-if="joining">Joining…</span>
          <span v-else>{{ request.final?.zoomLink || request.zoomLink ? 'Join Now' : 'Generate & Join' }}</span>
        </button>
        <div v-else class="status small">Join window opens 15 min before session</div>
      </template>

      <!-- Default -->
      <div v-else class="status">{{ formattedStatus }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import CountdownTimer from '@/components/CountdownTimer.vue'

const props = defineProps({
  request: { type: Object, required: true },
  isVolunteer: { type: Boolean, default: false },
  currentUserId: { type: String, default: '' },
})

const emit = defineEmits(['accepted', 'rejected', 'started', 'joined'])

const joining = ref(false)

// --- Status helpers ---
const statusClass = computed(() => `status-${props.request.status || 'pending'}`)
const formattedStatus = computed(() => {
  const s = props.request.status || 'pending'
  return s.charAt(0).toUpperCase() + s.slice(1)
})

// --- Session timing ---
const nextStartAt = computed(() => {
  if (props.request.scheduledAt) return props.request.scheduledAt
  if (props.request.final?.date && props.request.final?.time) {
    const t = String(props.request.final.time).split('-')[0].trim()
    return `${props.request.final.date}T${t}:00`
  }
  if (props.request.startAt) return props.request.startAt
  return null
})

const formattedTime = computed(() => {
  const dateStr = nextStartAt.value
  if (!dateStr) return 'Time not set'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'Invalid date'
  return d.toLocaleString()
})

const showCountdown = computed(() =>
  ['accepted', 'scheduled'].includes(props.request.status) && !!nextStartAt.value
)

// --- Ownership + join rules ---
const isOwner = computed(() => {
  const sid = props.request.student?._id || props.request.student
  const vid = props.request.volunteer?._id || props.request.volunteer
  return [sid, vid].map(String).includes(String(props.currentUserId))
})

const canJoinSession = computed(() => {
  const s = nextStartAt.value
  if (!s) return false
  const sessionTime = new Date(s)
  if (isNaN(sessionTime.getTime())) return false
  const now = new Date()
  const fifteenBefore = new Date(sessionTime.getTime() - 15 * 60 * 1000)
  const oneHourAfter = new Date(sessionTime.getTime() + 60 * 60 * 1000)
  return now >= fifteenBefore && now <= oneHourAfter
})

// --- Actions ---
function accept() {
  emit('accepted', props.request)
}
function reject() {
  if (confirm('Reject this session request?')) emit('rejected', props.request)
}
function onStarted(payload) {
  emit('started', { request: props.request, payload })
}

// If link exists use it, else generate
function joinHandler() {
  const url = props.request.final?.zoomLink || props.request.zoomLink
  if (url) {
    window.open(url, '_blank')
    emit('joined', { request: props.request, url })
  } else {
    generateAndJoin()
  }
}

async function generateAndJoin() {
  if (!props.request._id) return alert('Missing session id')
  if (!canJoinSession.value) return alert('Join window not open yet.')

  joining.value = true
  try {
    const token = localStorage.getItem('token') || ''
    const res = await fetch(`/api/sessions/${props.request._id}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'Failed to generate link')

    const url =
      data.joinUrl || data.zoomLink || data.url || data.final?.zoomLink || null
    if (!url) throw new Error('No join link returned by server')

    window.open(url, '_blank')
    emit('joined', { request: props.request, url, meta: data })
  } catch (err) {
    alert(err.message || 'Could not generate join link')
  } finally {
    joining.value = false
  }
}
</script>

<style scoped>
/* same CSS you already had, unchanged */
</style>
