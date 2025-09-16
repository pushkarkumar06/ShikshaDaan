<template>
  <div class="request-card" :class="statusClass">
    <div class="meta">
      <div class="header">
        <b>{{ request.fromName || request.studentName || 'Unknown User' }}</b>
        <span class="status-badge">{{ formattedStatus }}</span>
      </div>
      <div class="subject" v-if="request.subject">{{ request.subject }}</div>
      <div class="small message" v-if="request.message">{{ request.message }}</div>
      
      <div class="session-info" v-if="request.startAt || request.scheduledAt">
        <div class="time">
          <i class="icon">⏰</i>
          {{ formattedTime }}
        </div>
        <div v-if="request.zoomLink" class="zoom-link">
          <a :href="request.zoomLink" target="_blank" class="zoom-button">
            Join Zoom Meeting
          </a>
        </div>
      </div>
    </div>

    <div class="when">
      <CountdownTimer 
        v-if="showCountdown" 
        :startAt="request.startAt || request.scheduledAt" 
        class="countdown-timer" 
      />
      <div v-else-if="request.status === 'completed'" class="completed-text">
        Session completed
      </div>
      <div v-else-if="request.status === 'cancelled'" class="cancelled-text">
        Session cancelled
      </div>
    </div>

    <div class="actions">
      <template v-if="isVolunteer && request.status === 'pending'">
        <button @click="accept" class="accept-btn">
          Accept
        </button>
        <button @click="reject" class="reject-btn">
          Reject
        </button>
      </template>
      <template v-else-if="isOwner && request.status === 'scheduled'">
        <button 
          v-if="canJoinSession" 
          @click="joinSession" 
          class="join-btn"
        >
          Join Now
        </button>
      </template>
      <div v-else class="status">
        {{ formattedStatus }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits, computed } from 'vue';
import CountdownTimer from '@/components/CountdownTimer.vue';

const props = defineProps({ 
  request: {
    type: Object,
    required: true,
    default: () => ({
      status: 'pending',
      startAt: null,
      scheduledAt: null,
      subject: '',
      message: '',
      fromName: '',
      studentName: ''
    })
  }, 
  isVolunteer: {
    type: Boolean,
    default: false
  },
  currentUserId: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['accepted', 'rejected', 'join']);

// Computed properties
const statusClass = computed(() => ({
  'status-pending': props.request.status === 'pending',
  'status-accepted': props.request.status === 'accepted',
  'status-scheduled': props.request.status === 'scheduled',
  'status-completed': props.request.status === 'completed',
  'status-cancelled': props.request.status === 'cancelled',
  'status-rejected': props.request.status === 'rejected'
}));

const showCountdown = computed(() => {
  return ['accepted', 'scheduled'].includes(props.request.status) && 
         (props.request.startAt || props.request.scheduledAt);
});

const formattedStatus = computed(() => {
  const status = props.request.status || 'pending';
  return status.charAt(0).toUpperCase() + status.slice(1);
});

const formattedTime = computed(() => {
  const dateStr = props.request.startAt || props.request.scheduledAt;
  if (!dateStr) return 'Time not set';
  
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return 'Invalid date';
  }
});

const isOwner = computed(() => {
  if (!props.currentUserId) return false;
  return props.request.studentId === props.currentUserId || 
         props.request.volunteerId === props.currentUserId;
});

const canJoinSession = computed(() => {
  if (!props.request.startAt && !props.request.scheduledAt) return false;
  
  const now = new Date();
  const sessionTime = new Date(props.request.startAt || props.request.scheduledAt);
  const fifteenMinutesBefore = new Date(sessionTime.getTime() - 15 * 60000);
  
  // Can join 15 minutes before and up to 1 hour after scheduled time
  return now >= fifteenMinutesBefore && 
         now <= new Date(sessionTime.getTime() + 60 * 60000);
});

function accept() {
  if (!props.request._id) {
    console.error('Cannot accept request: Missing request ID');
    return;
  }
  emit('accepted', props.request);
}

function reject() {
  if (!props.request._id) {
    console.error('Cannot reject request: Missing request ID');
    return;
  }
  if (confirm('Are you sure you want to reject this session request?')) {
    emit('rejected', props.request);
  }
}

function joinSession() {
  if (props.request.zoomLink) {
    window.open(props.request.zoomLink, '_blank');
  } else {
    // Emit an event to handle joining through the app's video system
    emit('join', props.request);
  }
}
</script>

<style scoped>
.request-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  margin-bottom: 1rem;
  background-color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
  flex-wrap: wrap;
  gap: 1rem;
}

.request-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

/* Status-based styling */
.request-card.status-pending {
  border-left: 4px solid #f59e0b;
}

.request-card.status-accepted {
  border-left: 4px solid #3b82f6;
}

.request-card.status-scheduled {
  border-left: 4px solid #10b981;
}

.request-card.status-completed {
  border-left: 4px solid #6b7280;
  opacity: 0.8;
}

.request-card.status-cancelled,
.request-card.status-rejected {
  border-left: 4px solid #ef4444;
  opacity: 0.7;
}

.meta {
  flex: 1;
  min-width: 0;
}

.meta .header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 9999px;
  background-color: #f3f4f6;
  color: #4b5563;
}

.subject {
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
}

.message {
  color: #4b5563;
  margin: 0.5rem 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.session-info {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed #e5e7eb;
}

.session-info .time {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #4b5563;
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
}

.zoom-link {
  margin-top: 0.5rem;
}

.zoom-button {
  display: inline-block;
  background-color: #2d8cff;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  text-decoration: none;
  transition: background-color 0.2s;
  text-align: center;
}

.zoom-button:hover {
  background-color: #0c6fe4;
  color: white;
}

.when {
  margin: 0;
  text-align: center;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}

.countdown-timer {
  font-weight: 600;
  color: #10b981;
  font-size: 1.1rem;
  padding: 0.5rem 1rem;
  background-color: #f0fdf4;
  border-radius: 0.5rem;
  min-width: 160px;
  text-align: center;
}

.completed-text {
  color: #6b7280;
  font-style: italic;
  font-size: 0.95rem;
}

.cancelled-text {
  color: #ef4444;
  font-style: italic;
  font-size: 0.95rem;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 120px;
  justify-content: center;
  align-self: center;
}

button {
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border: 1px solid transparent;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.accept-btn {
  background-color: #10b981;
  color: white;
  border-color: #10b981;
}

.accept-btn:hover:not(:disabled) {
  background-color: #0d9f6e;
  transform: translateY(-1px);
}

.accept-btn:active:not(:disabled) {
  transform: translateY(0);
}

.reject-btn {
  background-color: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

.reject-btn:hover:not(:disabled) {
  background-color: #fee2e2;
  transform: translateY(-1px);
}

.reject-btn:active:not(:disabled) {
  transform: translateY(0);
}

.join-btn {
  background-color: #3b82f6;
  color: white;
  border-color: #3b82f6;
  width: 100%;
  font-weight: 600;
}

.join-btn:hover:not(:disabled) {
  background-color: #2563eb;
  transform: translateY(-1px);
}

.join-btn:active:not(:disabled) {
  transform: translateY(0);
}

.status {
  color: #4b5563;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
  padding: 0.5rem;
  border-radius: 0.375rem;
  background-color: #f9fafb;
  width: 100%;
}

.small {
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.5;
  margin: 0;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .request-card {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    padding: 1rem;
  }
  
  .when {
    margin: 0.5rem 0;
    text-align: left;
    align-items: flex-start;
    width: 100%;
  }
  
  .actions {
    width: 100%;
    margin-top: 0.5rem;
  }
  
  button {
    width: 100%;
  }
  
  .countdown-timer {
    width: 100%;
    text-align: left;
    justify-content: flex-start;
  }
}

/* Animation for status changes */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.request-card {
  animation: fadeIn 0.3s ease-out;
}
</style>