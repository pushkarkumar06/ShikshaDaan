<template>
  <div class="profile-modal">
    <div style="display:flex; gap:12px; align-items:center">
      <img v-if="profile.photoUrl" :src="profile.photoUrl" style="width:72px;height:72px;border-radius:8px;object-fit:cover" />
      <div>
        <h2 style="margin:0">{{ profile.name || 'Volunteer' }}</h2>
        <div class="small">{{ profile.userId }}</div>
      </div>
      <div style="margin-left:auto">
        <button @click="$emit('close')">Close</button>
      </div>
    </div>

    <hr />

    <div style="display:flex; gap:20px">
      <div style="flex:1">
        <h4>About</h4>
        <div>{{ profile.bio || '-' }}</div>

        <h4 style="margin-top:10px">Location / Timezone</h4>
        <div>{{ formatLocation(profile.location) }} • {{ profile.timezone || '-' }}</div>

        <h4 style="margin-top:10px">Subjects / Specialties</h4>
        <div>{{ (profile.subjects || []).join(', ') || '-' }}</div>

        <h4 style="margin-top:10px">Availability (next days)</h4>
        <div v-if="(profile.availability || []).length">
          <div v-for="d in profile.availability" :key="d.date" class="small" style="margin-bottom:6px">
            <b>{{ d.date }}</b> — {{ d.slots.join(', ') }}
          </div>
        </div>
        <div v-else class="small">No availability</div>
      </div>

      <div style="flex:1">
        <h4>Extras</h4>
        <div>Hourly rate: ₹{{ profile.hourlyRate ?? '-' }}/hr</div>
        <div>Avg rating: {{ profile.avgRating ?? '-' }} ({{ profile.ratingsCount ?? 0 }})</div>

        <h4 style="margin-top:12px">Recent reviews</h4>
        <div v-if="(reviews || []).length">
          <div v-for="r in reviews" :key="r._id" style="margin-bottom:8px">
            <b>{{ r.author?.name || 'Anonymous' }}</b> — {{ r.rating }}/5
            <div class="small">{{ r.comment || '-' }}</div>
          </div>
        </div>
        <div v-else class="small">No reviews</div>

        <h4 style="margin-top:12px">Raw (debug)</h4>
        <pre style="background:#0b1720;color:#cfeef5;padding:8px;border-radius:6px;max-height:220px;overflow:auto">{{ profile }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "VolunteerProfile",
  props: {
    profile: { type: Object, required: true },
    reviews: { type: Array, default: () => [] }
  },
  methods: {
    formatLocation(loc) {
      if (!loc) return '-'
      if (typeof loc === 'string') return loc
      return [loc.city, loc.state, loc.country].filter(Boolean).join(', ')
    }
  }
}
</script>

<style scoped>
.small { color: #cbd5e1; font-size: 13px; }
</style>
