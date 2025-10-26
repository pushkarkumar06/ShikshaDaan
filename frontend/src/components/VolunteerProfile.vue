<template>
  <div>
    <!-- Call room -->
    <CallRoom
      v-if="inCall"
      :roomId="activeRoomId || profile.userId"
      :userInfo="{ name: profile.name, photoUrl: profile.photoUrl, userId: profile.userId }"
      :token="jwtToken"
      @leave="leaveCall"
    />

    <div v-else>
      <!-- Header -->
      <div class="row" style="gap:12px; align-items:center;">
        <img
          v-if="profile.photoUrl"
          :src="profile.photoUrl"
          alt=""
          style="width:84px; height:84px; border-radius:8px; object-fit:cover; border:1px solid #e2e8f0"
        />
        <div>
          <div style="font-size:20px; font-weight:700">{{ profile.name || profile.userId }}</div>
          <div class="small">
            {{ profile.location || '-' }}
            {{ profile.timezone ? (' • ' + profile.timezone) : '' }}
          </div>
          <div class="small">Hourly: {{ profile.hourlyRate ? '₹' + profile.hourlyRate + '/hr' : '—' }}</div>

          <div style="margin-top: 12px; display: flex; gap: 8px;">
            <button @click="onStartCall" class="primary" :disabled="starting">
              <span v-if="!starting">Start Video Call</span>
              <span v-else>Starting…</span>
            </button>
            <button @click="$emit('message', profile.userId)" class="secondary">Message</button>
            <button v-if="canFollow" @click="$emit('follow', profile.userId)" class="secondary">Follow</button>
          </div>
        </div>
      </div>

      <hr />

      <!-- Main columns -->
      <div style="display:flex; gap:18px; flex-wrap:wrap;">
        <!-- Left: About & Availability -->
        <div style="flex:1; min-width:260px">
          <h3>About</h3>
          <div class="small">{{ profile.bio || '-' }}</div>

          <h3 style="margin-top:12px">Subjects</h3>
          <div>{{ (profile.subjects || []).join(', ') || '-' }}</div>

          <h3 style="margin-top:12px">Availability</h3>
          <div class="small" v-if="!availability.length">No availability published.</div>

          <div
            v-for="day in availability"
            :key="day.date"
            class="availability-day card"
            style="margin-bottom:8px;"
          >
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div><b>{{ day.date }}</b></div>
              <div class="small">Slots: {{ (day.slots || []).length }}</div>
            </div>

            <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
              <button
                v-for="slot in day.slots"
                :key="slot"
                :class="['slot-btn', slotBookingKey(day.date, slot) === bookingKey ? 'busy':'' ]"
                :disabled="isSlotDisabled(day.date, slot) || bookingKey !== ''"
                @click="onClickSlot(day.date, slot)"
                title="Click to request this slot"
              >
                <span v-if="slotBookingKey(day.date, slot) === bookingKey">Booking…</span>
                <span v-else>{{ slot }}</span>
              </button>

              <div v-if="day.slots.length === 0" class="small">No slots</div>
            </div>
          </div>

          <div class="small" style="margin-top:8px">
            Note: Students can click a slot to request booking. Volunteers see this as read-only.
          </div>
        </div>

        <!-- Right: Stats / Reviews -->
        <div style="flex:1; min-width:260px">
          <h3>Stats / Extras</h3>
          <div class="small">Followers: <slot name="followers">—</slot></div>
          <div class="small">Following: <slot name="following">—</slot></div>
          <div class="small">Avg rating: {{ profile.avgRating ?? '-' }}</div>

          <h3 style="margin-top:12px">Reviews</h3>
          <div v-if="reviews && reviews.length">
            <div v-for="r in reviews" :key="r._id" class="card" style="margin-bottom:8px">
              <div><b>{{ r.author?.name || 'Anonymous' }}</b> — {{ r.rating }}/5</div>
              <div class="small">{{ r.comment || '-' }}</div>
              <div class="small">{{ formatDate(r.createdAt) }}</div>
            </div>
          </div>
          <div v-else class="small">No reviews yet.</div>

          <!-- NEW: Upcoming Sessions panel (future only) -->
          <h3 style="margin-top:16px">Upcoming Sessions</h3>
          <div v-if="upcomingSessions.length === 0" class="small">No upcoming sessions.</div>
          <div v-for="s in upcomingSessions" :key="s._id" class="card" style="margin-bottom:8px">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:center;">
              <div class="small">
                <b>{{ s.subject || 'Selected Slot' }}</b><br />
                <span>{{ prettySlot(s) }}</span>
              </div>
              <div>
                <button class="primary" @click="joinFromStats(s)">Join</button>
              </div>
            </div>
          </div>

          <!-- NEW: Recent Sessions panel (already ended) -->
          <h3 style="margin-top:16px">Recent Sessions (most recent first)</h3>
          <div v-if="recentSessions.length === 0" class="small">No recent sessions.</div>
          <div v-for="s in recentSessions" :key="s._id" class="card" style="margin-bottom:8px">
            <div style="display:flex; justify-content:space-between; gap:12px;">
              <div>
                <b>{{ s.subject || 'Selected Slot' }}</b>
                <div class="small">{{ prettySlot(s) }}</div>
              </div>
              <div class="small" style="white-space:nowrap;">
                Ended: {{ endMsFrom(s) ? new Date(endMsFrom(s)).toLocaleString() : '-' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import CallRoom from "./CallRoom.vue";

const props = defineProps({
  profile: { type: Object, required: true },
  reviews: { type: Array, default: () => [] },
  canFollow: { type: Boolean, default: true },
  currentUserId: { type: String, default: null },
  currentUserRole: { type: String, default: null },
});
const emit = defineEmits([
  "joinFromStats",
  "started-call",
  "call-left",
  "message",
  "follow",
  "booked",
]);

// ---------------- UI state ----------------
const inCall = ref(false);
const activeRoomId = ref("");
const starting = ref(false);
const availability = ref([]); // [{ date, slots: [] }]
const loadingAvailability = ref(false);
const bookingKey = ref("");

// sessions state (optionally passed via props.profile.sessions)
const sessions = ref(
  Array.isArray(props.profile?.sessions) ? [...props.profile.sessions] : []
);

// tick "now" for time-based filters
const nowTs = ref(Date.now());
setInterval(() => (nowTs.value = Date.now()), 30_000);

// ---------------- time helpers ----------------
function startMsFrom(session) {
  if (session?.scheduledAt) {
    const t = new Date(session.scheduledAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (session?.final?.date && session?.final?.time) {
    const [Y, M, D] = String(session.final.date).split("-").map(Number);
    const [start] = String(session.final.time).split("-").map((s) => s.trim());
    const [hh, mm] = start.split(":").map(Number);
    const dt = new Date(Y, (M || 1) - 1, D, hh || 0, mm || 0, 0, 0);
    const t = dt.getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (session?.proposed?.date && session?.proposed?.time) {
    const [Y, M, D] = String(session.proposed.date).split("-").map(Number);
    const [start] = String(session.proposed.time).split("-").map((s) => s.trim());
    const [hh, mm] = start.split(":").map(Number);
    const dt = new Date(Y, (M || 1) - 1, D, hh || 0, mm || 0, 0, 0);
    const t = dt.getTime();
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function endMsFrom(session) {
  const start = startMsFrom(session);
  if (start == null) return null;
  const durMin = Number.isFinite(Number(session?.final?.durationMinutes))
    ? Number(session.final.durationMinutes)
    : 30;
  return start + Math.max(1, durMin) * 60 * 1000;
}

const UPCOMING_STATUSES = new Set(["scheduled", "accepted", "in-progress"]);

// future only
const upcomingSessions = computed(() => {
  if (!Array.isArray(sessions.value)) return [];
  const now = nowTs.value;
  return sessions.value
    .filter((s) => {
      if (!UPCOMING_STATUSES.has(String(s.status || "").toLowerCase())) return false;
      const end = endMsFrom(s);
      return end != null && now < end;
    })
    .sort((a, b) => (startMsFrom(a) ?? 0) - (startMsFrom(b) ?? 0));
});

// already ended
const recentSessions = computed(() => {
  if (!Array.isArray(sessions.value)) return [];
  const now = nowTs.value;
  return sessions.value
    .filter((s) => {
      const end = endMsFrom(s);
      return end != null && end <= now;
    })
    .sort((a, b) => (endMsFrom(b) ?? 0) - (endMsFrom(a) ?? 0));
});

const jwtToken = computed(() => {
  try {
    return localStorage.getItem("token") || null;
  } catch {
    return null;
  }
});

const isStudentViewer = computed(() => props.currentUserRole === "student");

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function prettySlot(s) {
  // a light formatter for the card rows
  if (s?.final?.date && s?.final?.time) {
    return `${s.final.date} — ${s.final.time}`;
  }
  if (s?.scheduledAt) {
    const dt = new Date(s.scheduledAt);
    return `${dt.toISOString().slice(0, 10)} — ${dt.toTimeString().slice(0, 5)}`;
  }
  return "-";
}

// ------------- Call controls -------------
async function onStartCall() {
  if (starting.value) return;
  starting.value = true;

  try {
    const res = await fetch("/api/rtc/room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jwtToken.value ? { Authorization: `Bearer ${jwtToken.value}` } : {}),
      },
      body: JSON.stringify({ target: props.profile.userId }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("Create room failed", res.status, txt);
      alert("Unable to create call room. Try again.");
      starting.value = false;
      return;
    }

    const data = await res.json();
    activeRoomId.value = data?.roomId || data?.room?.roomId || `call-${Date.now()}`;
    inCall.value = true;
    emit("started-call", { roomId: activeRoomId.value, target: props.profile.userId });
  } catch (err) {
    console.error("onStartCall error", err);
    alert("Could not start call — check network / permissions.");
  } finally {
    starting.value = false;
  }
}
function leaveCall() {
  inCall.value = false;
  activeRoomId.value = "";
  emit("call-left", { target: props.profile.userId });
}

// ------------- Availability -------------
async function loadAvailability() {
  if (!props.profile || !props.profile.userId) return;
  loadingAvailability.value = true;
  try {
    const token = localStorage.getItem("token") || "";
    const res = await fetch(`/api/volunteers/${props.profile.userId}/availability`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("Load availability failed", res.status, txt);
      availability.value = [];
      return;
    }
    const data = await res.json();
    availability.value = Array.isArray(data)
      ? data.map((d) => ({ date: d.date, slots: Array.isArray(d.slots) ? [...d.slots] : [] }))
      : [];
  } catch (err) {
    console.error("loadAvailability error", err);
    availability.value = [];
  } finally {
    loadingAvailability.value = false;
  }
}

function slotBookingKey(date, slot) {
  return `${date}|${slot}`;
}

async function onClickSlot(date, slot) {
  if (!isStudentViewer.value && props.currentUserRole !== "admin") {
    return alert("Only students can book slots from this view.");
  }
  if (!confirm(`Request a session on ${date} at ${slot}?`)) return;

  const key = slotBookingKey(date, slot);
  bookingKey.value = key;

  try {
    const token = localStorage.getItem("token") || "";
    const body = {
      target: props.profile.userId,
      subject: `Session request (${date} ${slot})`,
      message: `Booking request for ${date} ${slot}`,
      date,
      time: slot,
    };

    const res = await fetch("/api/sessions/request", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || "Booking failed");
    }

    removeSlotLocal(date, slot);
    await loadAvailability();
    emit("booked", { date, slot, response: data });

    alert("Request sent. Volunteer will be notified.");
  } catch (err) {
    console.error("Booking failed", err);
    alert(err.message || "Failed to send booking request");
  } finally {
    bookingKey.value = "";
  }
}

function removeSlotLocal(date, slot) {
  try {
    availability.value = availability.value.map((d) => {
      if (d.date !== date) return d;
      const normalizedWanted = String(slot).replace(/\s+/g, "");
      const filtered = (d.slots || []).filter((s) => {
        if (!s) return false;
        const ns = String(s).replace(/\s+/g, "");
        if (ns === normalizedWanted) return false;
        if (ns.startsWith(normalizedWanted) || normalizedWanted.startsWith(ns)) return false;
        return true;
      });
      return { ...d, slots: filtered };
    });
  } catch (e) {
    console.warn("removeSlotLocal failed", e);
  }
}

function isSlotDisabled(date, slot) {
  if (!props.currentUserId) return false;
  if (String(props.currentUserId) === String(props.profile.userId)) return true;
  if (bookingKey.value && bookingKey.value !== slotBookingKey(date, slot)) return true;
  return false;
}

// ------------- Sessions sync & actions -------------
function handleSessionScheduled(session) {
  try {
    const date =
      session.final?.date ||
      (session.scheduledAt ? new Date(session.scheduledAt).toISOString().split("T")[0] : null);
    const time =
      session.final?.time ||
      (session.scheduledAt ? new Date(session.scheduledAt).toTimeString().slice(0, 5) : null);
    if (date && time) removeSlotLocal(date, time);
    loadAvailability();

    if (session && session._id) {
      const exists = sessions.value.find((s) => s._id === session._id);
      if (!exists) sessions.value.push(session);
    }
  } catch (e) {
    console.warn("handleSessionScheduled failed", e);
  }
}

// emit to parent so it can navigate/open the right card/join
function joinFromStats(s) {
  emit("joinFromStats", s);
}

// keep availability & sessions synced when viewing different volunteer
watch(
  () => props.profile?.userId,
  (nv) => {
    if (nv) {
      loadAvailability();
    } else {
      availability.value = [];
    }
    sessions.value = Array.isArray(props.profile?.sessions)
      ? [...props.profile.sessions]
      : sessions.value;
  },
  { immediate: true }
);

onMounted(() => {
  if (props.profile && props.profile.userId) loadAvailability();
});
</script>

<style scoped>
.card {
  padding: 12px;
  background: #f8fafc;
  border-radius: 8px;
  margin-bottom: 12px;
}
button {
  padding: 8px 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.12s;
}
button.primary {
  background-color: #3b82f6;
  color: white;
}
button.primary:hover { background-color:#2563eb }
button.primary:disabled { opacity:.6; cursor:not-allowed; }

button.secondary {
  background-color: #e2e8f0;
  color: #1e293b;
  border: 1px solid #cbd5e1;
}
button.secondary:hover { background-color:#cbd5e1 }

.small { color: #64748b; font-size: 14px; line-height: 1.5; }
h3 { margin: 0 0 8px 0; font-size: 16px; color: #1e293b; }
.row { display:flex; align-items:center; }

/* availability */
.availability-day { border: 1px dashed #e6eef8; padding: 8px; border-radius: 8px; background: #fff; }
.slot-btn {
  background: #f1f5f9;
  border-radius: 8px;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  cursor: pointer;
}
.slot-btn:hover { transform: translateY(-2px); }
.slot-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.slot-btn.busy { background: #efefef; color: #111; font-weight:600; }
</style>
