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
          <div class="small">Click 'Load availability' (parent/component should implement loader)</div>
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
  },
  data() {
    return {
      inCall: false,
      activeRoomId: "",
      starting: false,
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
    }
  },
  methods: {
    formatDate(d) {
      try {
        return new Date(d).toLocaleString();
      } catch {
        return d;
      }
    },

    // Create a room on the server and join it
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
.row {
  display: flex;
  align-items: center;
}
</style>
