<template>
  <div>
    <CallRoom
      v-if="inCall"
      :roomId="activeRoomId || profile.userId"
      :userInfo="{ name: profile.name, photoUrl: profile.photoUrl, userId: profile.userId }"
      :token="jwtToken"
      @leave="leaveCall"
    />

    <div v-else>
      <div class="row" style="gap:12px; align-items:center;">
        <img
          v-if="profile.photoUrl"
          :src="profile.photoUrl"
          alt=""
          style="width:84px; height:84px; border-radius:8px; object-fit:cover; border:1px solid #e2e8f0"
        />
        <div>
          <div style="font-size:20px; font-weight:700">{{ profile.name || profile.userId }}</div>
          <div class="small">{{ profile.college || '' }} {{ profile.course ? '• ' + profile.course : '' }}</div>
        </div>
      </div>

      <hr />

      <div style="display:flex; gap:18px; flex-wrap:wrap;">
        <div style="flex:1; min-width:260px">
          <h3>About</h3>
          <div class="small">{{ profile.bio || '-' }}</div>

          <h3 style="margin-top:12px">Interests</h3>
          <div>{{ (profile.interests || []).join(', ') || '-' }}</div>

          <h3 style="margin-top:12px">Badges</h3>
          <div v-if="badges && badges.length" class="row" style="gap:8px; flex-wrap:wrap">
            <span v-for="b in badges" :key="b.key" class="badge">{{ b.label }} <span class="small">({{ formatDate(b.earnedAt) }})</span></span>
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
  },
  data() {
    return {
      inCall: false,
      activeRoomId: "",
      starting: false,
    };
  },
  computed: {
    // If you store JWT in localStorage/sessionStorage, CallRoom will accept token prop.
    jwtToken() {
      try {
        return localStorage.getItem("token") || null;
      } catch {
        return null;
      }
    }
  },
  methods: {
    formatDate(d) {
      try {
        return new Date(d).toLocaleDateString();
      } catch {
        return d;
      }
    },

    // Create a room on server and join it
    async onStartCall() {
      // prevent double clicks
      if (this.starting) return;
      this.starting = true;

      try {
        // POST /api/rtc/room { target } (server creates a UUID room and optionally notifies target)
        const res = await fetch("/api/rtc/room", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // send credentials (cookie) if your auth uses cookies
            // token in Authorization header if you use JWT
            ...(this.jwtToken ? { Authorization: `Bearer ${this.jwtToken}` } : {}),
          },
          body: JSON.stringify({ target: this.profile.userId }),
          credentials: "include",
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.error("Create room failed", res.status, txt);
          alert("Unable to create call room. Try again.");
          this.starting = false;
          return;
        }

        const data = await res.json();
        // expect { roomId, room }
        this.activeRoomId = data?.roomId || data?.room?.roomId || `call-${Date.now()}`;
        this.inCall = true;

        // Emit event upwards so parent can track telemetries/notifications if needed
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
button.primary {
  background-color: #3b82f6;
  color: white;
}
button.primary:hover {
  background-color: #2563eb;
}
button.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
button.secondary {
  background-color: #e2e8f0;
  color: #1e293b;
  border: 1px solid #cbd5e1;
}
button.secondary:hover {
  background-color: #cbd5e1;
}
.small {
  color: #64748b;
  font-size: 14px;
  line-height: 1.5;
}
h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: #1e293b;
}
.badge {
  background: #e2e8f0;
  color: #0f1724;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
}
.row {
  display: flex;
  align-items: center;
}
</style>
