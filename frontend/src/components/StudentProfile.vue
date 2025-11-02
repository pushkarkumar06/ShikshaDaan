<template>
  <div>
    <!-- Video Call (direct) -->
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
          alt="student"
          style="width:84px; height:84px; border-radius:8px; object-fit:cover; border:1px solid #e2e8f0"
        />
        <div>
          <div style="font-size:20px; font-weight:700">{{ profile.name || profile.userId }}</div>
          <div class="small">{{ profile.college || '' }} {{ profile.course ? '• ' + profile.course : '' }}</div>
        </div>
      </div>

      <hr />

      <!-- Profile Info -->
      <div style="display:flex; gap:18px; flex-wrap:wrap;">
        <div style="flex:1; min-width:260px">
          <h3>About</h3>
          <div class="small">{{ profile.bio || '-' }}</div>

          <h3 style="margin-top:12px">Interests</h3>
          <div>{{ (profile.interests || []).join(', ') || '-' }}</div>

          <h3 style="margin-top:12px">Badges</h3>
          <div v-if="badges && badges.length" class="row" style="gap:8px; flex-wrap:wrap">
            <span v-for="b in badges" :key="b.key" class="badge">
              {{ b.label }}
              <span class="small">({{ formatDate(b.earnedAt) }})</span>
            </span>
          </div>
          <div v-else class="small">No badges yet.</div>
        </div>

        <div style="flex:1; min-width:260px">
          <h3>Actions</h3>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom: 12px;">
            <button @click="onStartCall" class="primary" :disabled="starting">
              <span v-if="!starting">Start Video Call</span>
              <span v-else>Starting…</span>
            </button>
            <button @click="$emit('message', profile.userId)" class="secondary">Message</button>
            <button @click="$emit('follow', profile.userId)" class="secondary">Follow</button>
          </div>

          <!-- Session State -->
          <h3 style="margin-top:12px">Session Status</h3>
          <div v-if="session">
            <div class="small">
              <b>Status:</b> {{ session.status }}
            </div>
            <div v-if="session.final?.date && session.final?.time" class="small">
              <b>When:</b> {{ session.final.date }} {{ session.final.time }}
            </div>
            <div v-if="canJoin" style="margin-top:8px;">
              <button class="join-btn" @click="joinSession">Join Meeting</button>
            </div>
            <div v-else-if="session.status === 'scheduled'" class="small">
              Join window opens 15 min before session
            </div>
          </div>
          <div v-else class="small">No session info available.</div>

          <h3 style="margin-top:12px">Quick Info</h3>
          <div class="small">Year: {{ profile.year || '-' }}</div>
          <div class="small">Languages: {{ (profile.languages || []).join(', ') || '-' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import CallRoom from "./CallRoom.vue";

export default {
  name: "StudentProfile",
  components: { CallRoom },
  props: {
    profile: { type: Object, required: true },
    badges: { type: Array, default: () => [] },
    // session request object can be passed from parent
    session: { type: Object, default: null },
  },
  data() {
    return {
      inCall: false,
      activeRoomId: "",
      starting: false,
    };
  },
  computed: {
    jwtToken() {
      try {
        return localStorage.getItem("token") || null;
      } catch {
        return null;
      }
    },
    canJoin() {
      if (!this.session) return false;
      const dateStr = this.session.final?.date;
      const timeStr = this.session.final?.time;
      if (!dateStr || !timeStr) return false;
      const [hh, mm] = timeStr.split(":").map(Number);
      const start = new Date(dateStr);
      start.setHours(hh || 0, mm || 0, 0, 0);

      const now = new Date();
      const fifteenBefore = new Date(start.getTime() - 15 * 60 * 1000);
      const oneHourAfter = new Date(start.getTime() + 60 * 60 * 1000);
      return now >= fifteenBefore && now <= oneHourAfter;
    },
  },
  methods: {
    formatDate(d) {
      try {
        return new Date(d).toLocaleDateString();
      } catch {
        return d;
      }
    },

    async joinSession() {
      try {
        // Prefer existing zoom link
        if (this.session?.final?.zoomLink) {
          return window.open(this.session.final.zoomLink, "_blank");
        }
        // Else call backend join endpoint
        const res = await fetch(`/api/sessions/${this.session._id}/join`, {
          method: "POST",
          headers: {
            ...(this.jwtToken ? { Authorization: `Bearer ${this.jwtToken}` } : {}),
          },
        });
        const data = await res.json();
        const link = data?.zoomLink || data?.joinUrl;
        if (link) window.open(link, "_blank");
        else alert("No meeting link available.");
      } catch (err) {
        console.error("joinSession failed", err);
        alert(err.message || "Could not join session");
      }
    },

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
          credentials: "include",
        });
        if (!res.ok) throw new Error("Unable to create call room");
        const data = await res.json();
        this.activeRoomId = data?.roomId || data?.room?.roomId || `call-${Date.now()}`;
        this.inCall = true;
        this.$emit("started-call", { roomId: this.activeRoomId, target: this.profile.userId });
      } catch (err) {
        console.error("onStartCall error", err);
        alert(err.message || "Could not start call.");
      } finally {
        this.starting = false;
      }
    },
    leaveCall() {
      this.inCall = false;
      this.activeRoomId = "";
      this.$emit("call-left", { target: this.profile.userId });
    },
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
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
button.primary { background-color:#3b82f6; color:white; }
button.primary:hover { background-color:#2563eb; }
button.primary:disabled { opacity:.6; cursor:not-allowed; }
button.secondary {
  background-color:#e2e8f0;
  color:#1e293b;
  border:1px solid #cbd5e1;
}
button.secondary:hover { background-color:#cbd5e1 }
button.join-btn {
  background:#10b981;
  color:white;
  border:1px solid #059669;
  font-weight:600;
  padding:8px 14px;
  border-radius:6px;
}
button.join-btn:hover { background:#059669 }
.small { color:#64748b; font-size:14px; line-height:1.5; }
h3 { margin:0 0 8px 0; font-size:16px; color:#1e293b; }
.badge { background:#e2e8f0; color:#0f1724; padding:6px 8px; border-radius:8px; font-size:13px; }
.row { display:flex; align-items:center; }
</style>
