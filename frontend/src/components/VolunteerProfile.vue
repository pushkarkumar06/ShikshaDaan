<template>
  <div>
    <!-- CallRoom shown when inCall -->
    <CallRoom
      v-if="inCall"
      :roomId="activeRoomId || profile.userId"
      :userInfo="{ name: profile.name, photoUrl: profile.photoUrl, userId: profile.userId }"
      :token="jwtToken"
      @leave="leaveCall"
    />

    <div v-else>
      <!-- Basic header -->
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

      <!-- Main content -->
      <div style="display:flex; gap:18px; flex-wrap:wrap;">
        <div style="flex:1; min-width:260px">
          <h3>About</h3>
          <div class="small">{{ profile.bio || '-' }}</div>

          <h3 style="margin-top:12px">Subjects</h3>
          <div>{{ (profile.subjects || []).join(', ') || '-' }}</div>

          <h3 style="margin-top:12px">Availability</h3>
          <div class="small" v-if="!availability.length">No availability published.</div>

          <div v-for="day in availability" :key="day.date" class="availability-day card" style="margin-bottom:8px;">
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

          <div class="small" style="margin-top:8px">Note: Students can click a slot to request booking. Volunteers see this as read-only.</div>
        </div>

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
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import CallRoom from "./CallRoom.vue";

export default {
  name: "VolunteerProfile",
  components: { CallRoom },
  props: {
    profile: { type: Object, required: true },
    reviews: { type: Array, default: () => [] },
    canFollow: { type: Boolean, default: true },

    // optional: current viewer info to determine whether booking is allowed
    currentUserId: { type: String, default: null },
    currentUserRole: { type: String, default: null }, // 'student'|'volunteer'|'admin'
  },
  data() {
    return {
      inCall: false,
      activeRoomId: "",
      starting: false,
      availability: [], // [{ date, slots: [] }]
      loadingAvailability: false,
      bookingKey: "", // temporary key "date|slot" to mark in-progress booking
    };
  },
  computed: {
    // Adjust based on how you store auth (cookie vs localStorage token)
    jwtToken() {
      try {
        return localStorage.getItem("token") || null;
      } catch {
        return null;
      }
    },
    isStudentViewer() {
      return this.currentUserRole === "student";
    },
  },
  watch: {
    // reload availability whenever viewed profile changes
    "profile.userId": {
      immediate: true,
      handler() {
        if (this.profile && this.profile.userId) this.loadAvailability();
      },
    },
  },
  methods: {
    formatDate(d) {
      try {
        return new Date(d).toLocaleString();
      } catch {
        return d;
      }
    },

    // ---------- Call (unchanged) ----------
    async onStartCall() {
      if (this.starting) return;
      this.starting = true;

      try {
        const res = await fetch("/api/rtc/room", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.jwtToken ? { Authorization: `Bearer ${this.jwtToken}` } : {}),
          },
          body: JSON.stringify({ target: this.profile.userId }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.error("Create room failed", res.status, txt);
          alert("Unable to create call room. Try again.");
          this.starting = false;
          return;
        }

        const data = await res.json();
        this.activeRoomId = data?.roomId || data?.room?.roomId || `call-${Date.now()}`;
        this.inCall = true;

        this.$emit("started-call", { roomId: this.activeRoomId, target: this.profile.userId });
      } catch (err) {
        console.error("onStartCall error", err);
        alert("Could not start call — check network / permissions.");
      } finally {
        this.starting = false;
      }
    },
    leaveCall() {
      this.inCall = false;
      this.activeRoomId = "";
      this.$emit("call-left", { target: this.profile.userId });
    },

    // ---------- Availability loading & helpers ----------
    async loadAvailability() {
      if (!this.profile || !this.profile.userId) return;
      this.loadingAvailability = true;
      try {
        const token = localStorage.getItem("token") || "";
        const res = await fetch(`/api/volunteers/${this.profile.userId}/availability`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.warn("Load availability failed", res.status, txt);
          this.availability = [];
          return;
        }
        const data = await res.json();
        // Normalize: ensure array of {date, slots: []}
        this.availability = Array.isArray(data)
          ? data.map(d => ({ date: d.date, slots: Array.isArray(d.slots) ? [...d.slots] : [] }))
          : [];
      } catch (err) {
        console.error("loadAvailability error", err);
        this.availability = [];
      } finally {
        this.loadingAvailability = false;
      }
    },

    // Returns a stable key for marking in-progress bookings
    slotBookingKey(date, slot) {
      return `${date}|${slot}`;
    },

    // When user clicks a slot (student viewer)
    async onClickSlot(date, slot) {
      if (!this.isStudentViewer && this.currentUserRole !== "admin") {
        return alert("Only students can book slots from this view.");
      }
      if (!confirm(`Request a session on ${date} at ${slot}?`)) return;

      const key = this.slotBookingKey(date, slot);
      this.bookingKey = key;

      try {
        const token = localStorage.getItem("token") || "";
        const body = {
          target: this.profile.userId, // volunteer userId
          subject: `Session request (${date} ${slot})`,
          message: `Booking request for ${date} ${slot}`,
          date,
          time: slot,
        };

        const res = await fetch("/api/sessions/request", {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            // DO NOT set Content-Type when sending JSON? It's fine to set.
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Booking failed");
        }

        // If endpoint returned scheduled session or pending request, remove slot locally
        this.removeSlotLocal(date, slot);

        // Also refresh server availability (best-effort)
        await this.loadAvailability();

        // Emit an event parent can handle
        this.$emit("booked", { date, slot, response: data });

        alert("Request sent. Volunteer will be notified.");
      } catch (err) {
        console.error("Booking failed", err);
        alert(err.message || "Failed to send booking request");
      } finally {
        // clear booking marker
        this.bookingKey = "";
      }
    },

    // Remove a booked slot from local UI state (immediate feedback)
    removeSlotLocal(date, slot) {
      try {
        this.availability = this.availability.map(d => {
          if (d.date !== date) return d;
          const normalizedWanted = String(slot).replace(/\s+/g, "");
          const filtered = (d.slots || []).filter(s => {
            if (!s) return false;
            const ns = String(s).replace(/\s+/g, "");
            // exact match or containment (range vs single)
            if (ns === normalizedWanted) return false;
            if (ns.startsWith(normalizedWanted) || normalizedWanted.startsWith(ns)) return false;
            return true;
          });
          return { ...d, slots: filtered };
        });
      } catch (e) {
        console.warn("removeSlotLocal failed", e);
      }
    },

    // Helper to decide if a slot button should be disabled
    isSlotDisabled(date, slot) {
      // disable when volunteer viewing their own profile (they shouldn't book themselves)
      if (!this.currentUserId) return false;
      if (String(this.currentUserId) === String(this.profile.userId)) return true;
      // if slotBooking in progress disable
      if (this.bookingKey && this.bookingKey !== this.slotBookingKey(date, slot)) return true;
      return false;
    },

    // Called by parent when a session has been scheduled elsewhere (e.g., via socket)
    // Parent can call $refs.volProfile.handleSessionScheduled(session)
    handleSessionScheduled(session) {
      try {
        const date = session.final?.date || (session.scheduledAt ? new Date(session.scheduledAt).toISOString().split("T")[0] : null);
        const time = session.final?.time || (session.scheduledAt ? new Date(session.scheduledAt).toTimeString().slice(0,5) : null);
        if (date && time) this.removeSlotLocal(date, time);
        // optionally reload availability
        this.loadAvailability();
      } catch (e) { console.warn("handleSessionScheduled failed", e); }
    },
  },
  mounted() {
    if (this.profile && this.profile.userId) this.loadAvailability();
  },
};
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
