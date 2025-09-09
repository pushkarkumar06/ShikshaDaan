<template>
  <div class="profile-modal">
    <div style="display:flex; gap:12px; align-items:center">
      <img v-if="profile.photoUrl" :src="profile.photoUrl" style="width:72px;height:72px;border-radius:8px;object-fit:cover" />
      <div>
        <h2 style="margin:0">{{ profile.name || 'Student' }}</h2>
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

        <h4 style="margin-top:10px">Education</h4>
        <div>College: {{ profile.college || '-' }}</div>
        <div>Course: {{ profile.course || '-' }}</div>
        <div>Year: {{ profile.year || '-' }}</div>

        <h4 style="margin-top:10px">Interests</h4>
        <div>{{ (profile.interests || []).join(', ') || '-' }}</div>
      </div>

      <div style="flex:1">
        <h4>Extras</h4>
        <div>Email: {{ profile.email || '-' }}</div>

        <h4 style="margin-top:12px">Raw (debug)</h4>
        <pre style="background:#0b1720;color:#cfeef5;padding:8px;border-radius:6px;max-height:220px;overflow:auto">{{ profile }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "StudentProfile",
  props: {
    profile: { type: Object, required: true }
  }
}
</script>

<style scoped>
.small { color: #cbd5e1; font-size: 13px; }
</style>
