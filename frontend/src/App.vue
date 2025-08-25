<template>
  <div class="container">
    <h1>ShikshaDaan – Test UI (Vue)</h1>
    <p class="small">Quick test UI to exercise the backend endpoints. Build your real UI later.</p>

    <!-- Top bar: user & actions -->
    <div class="card row" style="align-items:center; justify-content:space-between;">
      <div>
        <div v-if="user">
          <div><b>{{ user.name }}</b> — <span class="badge">{{ user.role }}</span></div>
          <div class="small">_id: {{ user._id }}</div>
        </div>
        <div v-else class="small">Not logged in</div>
      </div>
      <div class="row">
        <button class="ghost" @click="switchTab('auth')">Auth</button>
        <button class="ghost" @click="switchTab('volunteer')">Volunteer Profile</button>
        <button class="ghost" @click="switchTab('explore')">Explore Volunteers</button>
        <button class="ghost" @click="switchTab('sessions')">My Requests</button>
        <button class="ghost" @click="switchTab('notifications')">Notifications</button>
        <button class="ghost" @click="switchTab('review')">Post Review</button>
        <button v-if="user" class="danger" @click="logout">Logout</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab" :class="{active: tab==='auth'}" @click="switchTab('auth')">Auth</div>
      <div class="tab" :class="{active: tab==='volunteer'}" @click="switchTab('volunteer')">Volunteer Profile</div>
      <div class="tab" :class="{active: tab==='explore'}" @click="switchTab('explore')">Explore</div>
      <div class="tab" :class="{active: tab==='sessions'}" @click="switchTab('sessions')">Requests</div>
      <div class="tab" :class="{active: tab==='notifications'}" @click="switchTab('notifications')">Notifications</div>
      <div class="tab" :class="{active: tab==='review'}" @click="switchTab('review')">Review</div>
    </div>

    <!-- AUTH -->
    <div v-if="tab==='auth'" class="card">
      <h2>Signup</h2>
      <div class="row">
        <div style="flex:1">
          <label>Name</label>
          <input v-model="signupForm.name" placeholder="Name" />
        </div>
        <div style="flex:1">
          <label>Email</label>
          <input v-model="signupForm.email" placeholder="Email" />
        </div>
        <div style="flex:1">
          <label>Password</label>
          <input type="password" v-model="signupForm.password" placeholder="Password" />
        </div>
        <div style="flex:1">
          <label>Role</label>
          <select v-model="signupForm.role">
            <option value="volunteer">volunteer</option>
            <option value="student">student</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <button @click="signup">Signup</button>
      </div>
      <hr />
      <h2>Login</h2>
      <div class="row">
        <div style="flex:1">
          <label>Email</label>
          <input v-model="loginForm.email" placeholder="Email" />
        </div>
        <div style="flex:1">
          <label>Password</label>
          <input type="password" v-model="loginForm.password" placeholder="Password" />
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <button @click="login">Login</button>
      </div>
      <div v-if="lastResponse" class="card" style="margin-top:12px">
        <div class="small">Last response</div>
        <pre>{{ lastResponse }}</pre>
      </div>
    </div>

    <!-- VOLUNTEER PROFILE (only if logged in as volunteer) -->
    <div v-if="tab==='volunteer'" class="card">
      <h2>Volunteer Profile</h2>
      <p class="small" v-if="!isVolunteer">Login as a <b>volunteer</b> to edit profile.</p>
      <div v-if="isVolunteer">
        <div class="row">
          <div style="flex:1">
            <label>Education</label>
            <input v-model="profileForm.education" placeholder="B.Sc. Mathematics" />
          </div>
          <div style="flex:1">
            <label>Experience</label>
            <input v-model="profileForm.experience" placeholder="2 years tutoring" />
          </div>
        </div>
        <div style="margin-top:10px">
          <label>Bio</label>
          <textarea v-model="profileForm.bio" placeholder="About you..."></textarea>
        </div>
        <div class="row" style="margin-top:10px">
          <div style="flex:1">
            <label>Subjects (comma separated)</label>
            <input v-model="profileSubjects" placeholder="Math, Science" />
          </div>
          <div style="flex:1">
            <label>Languages (comma separated)</label>
            <input v-model="profileLanguages" placeholder="English, Hindi" />
          </div>
        </div>
        <div class="row" style="margin-top:10px">
          <button @click="saveProfile">Save Profile</button>
          <button class="ghost" @click="loadMyProfile">Reload My Profile</button>
        </div>

        <div v-if="profileRaw" class="card">
          <div class="small">Current profile (raw)</div>
          <pre>{{ profileRaw }}</pre>
        </div>

        <!-- BADGES -->
        <hr />
        <h3>Badges</h3>
        <div class="row" v-if="(myBadges || []).length">
          <span v-for="b in myBadges" :key="b.key" class="badge">
            {{ b.label }} <span class="small">({{ formatDate(b.earnedAt) }})</span>
          </span>
        </div>
        <div v-else class="small">No badges yet.</div>
        <div class="row" style="margin-top:10px">
          <button class="ghost" @click="recomputeMyBadges">Recompute badges (test)</button>
          <button class="ghost" @click="loadMyBadges">Reload badges</button>
        </div>
        <div v-if="myStats" class="card" style="margin-top:10px">
          <div class="small">Your stats</div>
          <pre>{{ myStatsPretty }}</pre>
        </div>

        <!-- AVAILABILITY EDITOR -->
        <hr />
        <h3>Availability (pick date, toggle slots)</h3>
        <div class="row" style="align-items:center">
          <div>
            <label>Date</label>
            <input v-model="availDate" placeholder="YYYY-MM-DD" />
          </div>
          <button class="ghost" @click="loadDayAvailability">Load Day</button>
        </div>

        <div class="row" style="margin-top:10px">
          <button
            v-for="s in slotGrid"
            :key="s"
            :class="['tab', daySlots.includes(s) ? 'active' : '' ]"
            @click="toggleSlot(s)"
          >{{ s }}</button>
        </div>
        <div class="row" style="margin-top:10px">
          <button @click="saveDayReplace">Save Day (replace)</button>
        </div>
      </div>
    </div>

    <!-- EXPLORE VOLUNTEERS (public) -->
    <div v-if="tab==='explore'" class="card">
      <h2>Explore Volunteers</h2>
      <div class="row">
        <div style="flex:1">
          <label>Filter by subject</label>
          <input v-model="exploreSubject" placeholder="e.g. Math" />
        </div>
        <button @click="loadVolunteers">Search</button>
      </div>
      <div class="row" style="margin-top:10px">
        <div style="flex:1">
          <label>Manual Target UserId (for Session Request)</label>
          <input v-model="manualTargetId" placeholder="Paste student userId here (target)" />
        </div>
        <div style="flex:1">
          <label>Subject (for request)</label>
          <input v-model="requestSubject" placeholder="Math" />
        </div>
        <button @click="sendSessionRequest">Send Request (as Volunteer)</button>
      </div>
      <div class="row" style="margin-top:10px;">
        <div v-for="v in volunteers" :key="v._id" class="card" style="flex:1; min-width:260px;">
          <div><b>Volunteer</b></div>
          <div class="small">userId: {{ v.userId }}</div>
          <div>Subjects: {{ (v.subjects||[]).join(", ") }}</div>
          <div>Bio: {{ v.bio || '-' }}</div>
        </div>
      </div>

      <!-- STUDENT BOOKING PANEL -->
      <hr />
      <h2>Book Session (as Student)</h2>
      <p class="small">Enter a volunteer's userId → load availability → click a slot to request.</p>
      <div class="row">
        <div style="flex:2">
          <label>Volunteer UserId</label>
          <input v-model="bookVolunteerId" placeholder="paste volunteer userId" />
        </div>
        <button @click="loadVolunteerAvailability">Load Availability</button>
      </div>

      <div v-if="volunteerAvail.length" class="card" style="margin-top:10px">
        <div class="row">
          <div class="small">Pick date:</div>
          <button
            v-for="d in volunteerAvail.map(v => v.date)"
            :key="d"
            :class="['tab', bookDate===d ? 'active':'' ]"
            @click="onPickBookDate(d)"
          >{{ d }}</button>
        </div>

        <div class="row" style="margin-top:10px">
          <button
            v-for="s in bookSlots"
            :key="s"
            class="tab"
            @click="bookSlotAsStudent(s)"
          >{{ s }}</button>
        </div>
        <div class="small" v-if="!bookSlots.length">No slots for selected date.</div>
      </div>
    </div>

    <!-- REQUESTS -->
    <div v-if="tab==='sessions'" class="card">
      <h2>My Session Requests</h2>
      <div class="row">
        <button @click="loadMyRequests">Reload</button>
      </div>
      <div v-for="r in myRequests" :key="r._id" class="card">
        <div>Subject: <b>{{ r.subject }}</b></div>
        <div>Status: {{ r.status }}</div>
        <div v-if="r.proposed">Proposed: {{ r.proposed.date }} {{ r.proposed.time }}</div>
        <div v-if="r.final">Final: {{ r.final.date }} {{ r.final.time }} — <a :href="r.final.zoomLink" target="_blank">Join</a></div>

        <!-- If I am the target & not scheduled, show accept/schedule -->
        <div v-if="user && String(r.target) === String(user._id) && r.status !== 'scheduled'" class="row" style="margin-top:10px">
          <input v-model="acceptDate" placeholder="YYYY-MM-DD" />
          <input v-model="acceptTime" placeholder="HH:mm" />
          <button @click="acceptRequest(r._id)">Accept & Schedule</button>
        </div>
      </div>
    </div>

    <!-- NOTIFICATIONS -->
    <div v-if="tab==='notifications'" class="card">
      <h2>Notifications</h2>
      <div class="row">
        <button @click="loadNotifications">Reload</button>
      </div>
      <div v-for="n in notifications" :key="n._id" class="card">
        <div>Type: <b>{{ n.type }}</b> <span v-if="!n.read" class="badge">new</span></div>
        <div class="small">payload: {{ n.payload }}</div>
        <div class="row" style="margin-top:6px">
          <button v-if="!n.read" @click="markNotifRead(n._id)">Mark read</button>
        </div>
      </div>
    </div>

    <!-- POST REVIEW (as student/admin) -->
    <div v-if="tab==='review'" class="card">
      <h2>Post a Review</h2>
      <p class="small">Use a student/admin token to review a volunteer (enter volunteer's userId).</p>
      <div class="row">
        <div style="flex:2">
          <label>Volunteer UserId</label>
          <input v-model="reviewForm.volunteerId" placeholder="volunteer userId" />
        </div>
        <div style="flex:1">
          <label>Rating (1-5)</label>
          <input type="number" min="1" max="5" v-model.number="reviewForm.rating" />
        </div>
      </div>
      <div style="margin-top:10px">
        <label>Comment</label>
        <textarea v-model="reviewForm.comment" placeholder="Your feedback..."></textarea>
      </div>
      <div class="row" style="margin-top:10px">
        <button @click="postReview">Submit Review</button>
      </div>
      <div v-if="lastResponse" class="card" style="margin-top:12px">
        <div class="small">Last response</div>
        <pre>{{ lastResponse }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'

const API = 'http://localhost:5000/api'

// ---------- auth state ----------
const token = ref(localStorage.getItem('token') || '')
const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))
const tab = ref('auth')
const lastResponse = ref('')

// ---------- forms ----------
const signupForm = reactive({ name: '', email: '', password: '', role: 'volunteer' })
const loginForm = reactive({ email: '', password: '' })

// volunteer profile
const profileForm = reactive({ education: '', experience: '', bio: '', subjects: [], languages: [] })
const profileRaw = ref('')
const profileSubjects = ref('')
const profileLanguages = ref('')

// explore
const exploreSubject = ref('')
const volunteers = ref([])
const manualTargetId = ref('')
const requestSubject = ref('')

// sessions
const myRequests = ref([])
const acceptDate = ref('2025-08-27')
const acceptTime = ref('10:30')

// notifications
const notifications = ref([])

// reviews
const reviewForm = reactive({ volunteerId: '', rating: 5, comment: '' })

// badges
const myBadges = ref([])
const myStats = ref(null)
const myStatsPretty = computed(() => myStats.value ? JSON.stringify(myStats.value, null, 2) : '')

const isVolunteer = computed(() => user.value && user.value.role === 'volunteer')

// ---------- helpers ----------
function setAuth(t, u) {
  token.value = t
  user.value = u
  localStorage.setItem('token', t)
  localStorage.setItem('user', JSON.stringify(u))
}

function logout() {
  token.value = ''
  user.value = null
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || 'Request failed')
  return data
}

function switchTab(t) {
  tab.value = t
  if (t === 'explore') loadVolunteers()
  if (t === 'sessions') loadMyRequests()
  if (t === 'notifications') loadNotifications()
  if (t === 'volunteer' && isVolunteer.value) {
    loadMyProfile()
    loadDayAvailability()
    loadMyBadges()        // ← load badges when opening volunteer tab
  }
}

function formatDate(d) {
  try { return new Date(d).toLocaleDateString() } catch { return d }
}

// ---------- actions ----------
async function signup() {
  try {
    const data = await api('/auth/signup', { method: 'POST', body: JSON.stringify(signupForm) })
    setAuth(data.token, data.user)
    lastResponse.value = JSON.stringify(data, null, 2)
    tab.value = 'volunteer'
  } catch (e) { alert(e.message) }
}

async function login() {
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(loginForm) })
    setAuth(data.token, data.user)
    lastResponse.value = JSON.stringify(data, null, 2)
    tab.value = 'explore'
  } catch (e) { alert(e.message) }
}

// volunteer profile
async function loadMyProfile() {
  if (!user.value) return
  try {
    const data = await api(`/volunteers/${user.value._id}`, { method: 'GET' })
    profileRaw.value = JSON.stringify(data, null, 2)
    const p = data.profile || {}
    profileForm.education = p.education || ''
    profileForm.experience = p.experience || ''
    profileForm.bio = p.bio || ''
    profileForm.subjects = p.subjects || []
    profileForm.languages = p.languages || []
    profileSubjects.value = profileForm.subjects.join(', ')
    profileLanguages.value = profileForm.languages.join(', ')
  } catch (e) { alert(e.message) }
}

async function saveProfile() {
  try {
    profileForm.subjects = profileSubjects.value.split(',').map(s => s.trim()).filter(Boolean)
    profileForm.languages = profileLanguages.value.split(',').map(s => s.trim()).filter(Boolean)
    const data = await api('/volunteers/me', { method: 'PUT', body: JSON.stringify(profileForm) })
    profileRaw.value = JSON.stringify(data, null, 2)
    alert('Profile saved')
  } catch (e) { alert(e.message) }
}

// explore volunteers (public)
async function loadVolunteers() {
  try {
    const q = exploreSubject.value ? `?subject=${encodeURIComponent(exploreSubject.value)}` : ''
    const data = await fetch(`${API}/volunteers${q}`).then(r => r.json())
    volunteers.value = Array.isArray(data) ? data : []
  } catch (e) { alert(e.message) }
}

// send session request (as volunteer)
async function sendSessionRequest() {
  if (!user.value) return alert('Login first')
  if (user.value.role !== 'volunteer') return alert('Only volunteers can send requests')
  if (!manualTargetId.value) return alert('Enter target (student) userId')
  try {
    const body = {
      target: manualTargetId.value.trim(),
      subject: requestSubject.value || 'General',
      message: "I'd like to teach this topic",
      date: '2025-08-26',
      time: '11:00',
    }
    const data = await api('/sessions/request', { method: 'POST', body: JSON.stringify(body) })
    lastResponse.value = JSON.stringify(data, null, 2)
    alert('Request sent!')
  } catch (e) { alert(e.message) }
}

// my requests (as volunteer or target)
async function loadMyRequests() {
  try {
    const data = await api('/sessions/mine', { method: 'GET' })
    myRequests.value = Array.isArray(data) ? data : []
  } catch (e) { alert(e.message) }
}

async function acceptRequest(requestId) {
  try {
    const body = { date: acceptDate.value, time: acceptTime.value }
    const data = await api(`/sessions/${requestId}/accept`, { method: 'POST', body: JSON.stringify(body) })
    lastResponse.value = JSON.stringify(data, null, 2)
    await loadMyRequests()
    alert('Accepted & scheduled')
  } catch (e) { alert(e.message) }
}

// notifications
async function loadNotifications() {
  try {
    const data = await api('/notifications', { method: 'GET' })
    notifications.value = Array.isArray(data) ? data : []
  } catch (e) { alert(e.message) }
}

async function markNotifRead(id) {
  try {
    await api(`/notifications/${id}/read`, { method: 'POST' })
    await loadNotifications()
  } catch (e) { alert(e.message) }
}

// reviews
async function postReview() {
  try {
    const data = await api('/reviews', { method: 'POST', body: JSON.stringify(reviewForm) })
    lastResponse.value = JSON.stringify(data, null, 2)
    alert('Review posted')
  } catch (e) { alert(e.message) }
}

/* =========================
   BADGES – VOLUNTEER
   ========================= */
async function loadMyBadges() {
  if (!user.value) return
  const data = await api('/users/me', { method: 'GET' })
  myBadges.value = data.badges || []
}

async function recomputeMyBadges() {
  try {
    const data = await api('/users/me/recompute-badges', { method: 'POST' })
    myBadges.value = data.badges || []
    myStats.value = data.stats || null
  } catch (e) { alert(e.message) }
}

/* =========================
   AVAILABILITY – VOLUNTEER
   ========================= */
const availDate = ref('2025-08-28')
const slotGrid = [
  "09:00-09:30","09:30-10:00","10:00-10:30","10:30-11:00",
  "11:00-11:30","11:30-12:00","12:00-12:30","12:30-13:00",
  "14:00-14:30","14:30-15:00","15:00-15:30","15:30-16:00",
  "16:00-16:30","16:30-17:00","17:00-17:30","17:30-18:00"
]
const daySlots = ref([])

async function loadDayAvailability() {
  if (!user.value) return
  const data = await fetch(`${API}/volunteers/${user.value._id}/availability?from=${availDate.value}&to=${availDate.value}`).then(r=>r.json())
  const day = Array.isArray(data) ? data.find(d => d.date === availDate.value) : null
  daySlots.value = day ? [...day.slots] : []
}

async function toggleSlot(s) {
  if (!user.value) return
  const action = daySlots.value.includes(s) ? 'remove' : 'add'
  await api('/volunteers/me/availability', {
    method: 'PATCH',
    body: JSON.stringify({ date: availDate.value, slot: s, action })
  })
  await loadDayAvailability()
}

async function saveDayReplace() {
  await api('/volunteers/me/availability', {
    method: 'PUT',
    body: JSON.stringify({ date: availDate.value, slots: daySlots.value })
  })
  alert('Availability saved')
}

/* =========================
   BOOKING – STUDENT
   ========================= */
const bookVolunteerId = ref('')
const bookDate = ref('')
const bookSlots = ref([])
const volunteerAvail = ref([])

async function loadVolunteerAvailability() {
  if (!bookVolunteerId.value) return alert('Enter volunteer userId')
  const data = await fetch(`${API}/volunteers/${bookVolunteerId.value.trim()}/availability`).then(r=>r.json())
  volunteerAvail.value = Array.isArray(data) ? data : []
  bookDate.value = volunteerAvail.value[0]?.date || ''
  bookSlots.value = volunteerAvail.value.find(d => d.date === bookDate.value)?.slots || []
}

function onPickBookDate(d) {
  bookDate.value = d
  bookSlots.value = volunteerAvail.value.find(x => x.date === d)?.slots || []
}

async function bookSlotAsStudent(slot) {
  if (!user.value) return alert('Login first')
  if (user.value.role !== 'student' && user.value.role !== 'admin') {
    return alert('Only student/admin can book this way')
  }
  if (!bookVolunteerId.value || !bookDate.value) return alert('Pick volunteer and date')
  const body = {
    volunteerId: bookVolunteerId.value.trim(),
    subject: 'Selected Slot',
    message: 'Booking via availability',
    date: bookDate.value,
    slot
  }
  const data = await api('/sessions/request-to-volunteer', { method: 'POST', body: JSON.stringify(body) })
  lastResponse.value = JSON.stringify(data, null, 2)
  alert('Request sent to volunteer!')
}

onMounted(() => {
  if (user.value) switchTab('explore')
})
</script>
