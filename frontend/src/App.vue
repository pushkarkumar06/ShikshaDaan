<template>
  <div class="container">
    <h1>ShikshaDaan – Test UI (Vue)</h1>
    <p class="small">Quick test UI to exercise the backend endpoints. Build your real UI later.</p>

    <!-- Top bar -->
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
        <button 
  v-if="user && user.role === 'volunteer'" 
  class="ghost" 
  @click="switchTab('volunteer')"
>
  Volunteer Profile
</button>
        <button class="ghost" @click="switchTab('explore')">Explore</button>
        <button class="ghost" @click="switchTab('stats')">Stats</button>
        <button class="ghost" @click="switchTab('sessions')">My Requests</button>
        <div style="position:relative; display:inline-block;">
  <button class="ghost" @click="switchTab('notifications')">Notifications</button>
  <span v-if="notifUnread > 0"
        style="position:absolute; top:-4px; right:-4px; width:10px; height:10px; background:#e11d48; border-radius:50%; display:inline-block;"></span>
</div>
        <button class="ghost" @click="switchTab('review')">Post Review</button>
        <button class="ghost" @click="switchTab('people')">People</button>

        <div style="position:relative; display:inline-block;">
          <button class="ghost" @click="switchTab('chats')">Chats</button>
          <span v-if="notifTotalUnread > 0" style="position:absolute; top:-4px; right:-4px; width:10px; height:10px; background:#e11d48; border-radius:50%; display:inline-block;"></span>
        </div>

        <button v-if="user" class="danger" @click="logout">Logout</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab" :class="{active: tab==='auth'}" @click="switchTab('auth')">Auth</div>
     <div 
  v-if="user && user.role === 'volunteer'" 
  class="tab" 
  :class="{active: tab==='volunteer'}" 
  @click="switchTab('volunteer')"
>
  Volunteer
</div>

      <div 
  v-if="user && user.role === 'student'" 
  class="tab" 
  :class="{active: tab==='student'}" 
  @click="switchTab('student')"
>
  Student
</div>

      <div class="tab" :class="{active: tab==='explore'}" @click="switchTab('explore')">Explore</div>
      <div class="tab" :class="{active: tab==='stats'}" @click="switchTab('stats')">Stats</div>
      <div class="tab" :class="{active: tab==='sessions'}" @click="switchTab('sessions')">Requests</div>
      <div class="tab" :class="{active: tab==='notifications'}" @click="switchTab('notifications')">
  Notifications
  <span v-if="notifUnread > 0" class="badge">{{ notifUnread }}</span>
</div>
      <div class="tab" :class="{active: tab==='review'}" @click="switchTab('review')">Review</div>
      <div class="tab" :class="{active: tab==='people'}" @click="switchTab('people')">People</div>
      <div class="tab" :class="{active: tab==='chats'}" @click="switchTab('chats')">
        Chats
        <span v-if="notifTotalUnread > 0" class="badge">{{ notifTotalUnread }}</span>
      </div>
      <div v-if="user && user.role === 'student'" class="tab" :class="{active: tab==='studentProgress'}" @click="switchTab('studentProgress')">My Progress</div>
    </div>

    <!-- AUTH -->
    <div v-if="tab==='auth'" class="card">
      <h2>Signup</h2>
      <div class="row">
        <div style="flex:1"><label>Name</label><input v-model="signupForm.name" placeholder="Name" /></div>
        <div style="flex:1"><label>Email</label><input v-model="signupForm.email" placeholder="Email" /></div>
        <div style="flex:1"><label>Password</label><input type="password" v-model="signupForm.password" placeholder="Password" /></div>
        <div style="flex:1">
          <label>Role</label>
          <select v-model="signupForm.role">
            <option value="volunteer">volunteer</option>
            <option value="student">student</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:10px"><button @click="signup">Signup</button></div>
      <hr />
      <h2>Login</h2>
      <div class="row">
        <div style="flex:1"><label>Email</label><input v-model="loginForm.email" placeholder="Email" /></div>
        <div style="flex:1"><label>Password</label><input type="password" v-model="loginForm.password" placeholder="Password" /></div>
      </div>
      <div class="row" style="margin-top:10px"><button @click="login">Login</button></div>
      <div v-if="lastResponse" class="card" style="margin-top:12px"><div class="small">Last response</div><pre>{{ lastResponse }}</pre></div>
    </div>

    <!-- PEOPLE -->
    <div v-if="tab==='people'" class="card">
      <h2>People</h2>
      <p class="small">Follow anyone by their userId. View and manage your followers/following.</p>
      <div class="row" v-if="user">
        <div style="flex:2"><label>Follow userId</label><input v-model="followTargetId" placeholder="paste userId to follow" /></div>
        <button @click="followById">Follow</button>
      </div>
      <div class="row" style="margin-top:12px"><button class="ghost" @click="loadNetwork">Reload</button></div>
      <div class="row" style="margin-top:12px; align-items:flex-start">
        <div class="card" style="flex:1; min-width:280px;">
          <h3>Followers ({{ followers.length }})</h3>
          <div v-if="!followers.length" class="small">No followers yet.</div>
          <div v-for="p in followers" :key="p._id" class="row" style="justify-content:space-between; align-items:center">
            <div><div><b>{{ p.name }}</b> <span class="badge">{{ p.role }}</span></div><div class="small">_id: {{ p._id }}</div></div>
            <div class="row" style="gap:6px">
              <button class="ghost" @click="startChatWith(p._id)">Message</button>
              <button class="ghost" @click="unfollowById(p._id)" v-if="isFollowingId(p._id)">Unfollow</button>
            </div>
          </div>
        </div>
        <div class="card" style="flex:1; min-width:280px;">
          <h3>Following ({{ following.length }})</h3>
          <div v-if="!following.length" class="small">You're not following anyone yet.</div>
          <div v-for="p in following" :key="p._id" class="row" style="justify-content:space-between; align-items:center">
            <div><div><b>{{ p.name }}</b> <span class="badge">{{ p.role }}</span></div><div class="small">_id: {{ p._id }}</div></div>
            <div class="row" style="gap:6px">
              <button class="ghost" @click="startChatWith(p._id)">Message</button>
              <button class="ghost" @click="unfollowById(p._id)">Unfollow</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VOLUNTEER PROFILE (old UI look with avatar circle) -->
    <div v-if="tab==='volunteer'" class="card">
      <h2>Volunteer Profile</h2>
      <p class="small" v-if="!isVolunteer">Login as a <b>volunteer</b> to edit profile.</p>

      <div v-if="isVolunteer">
        <!-- Photo + main fields -->
        <div class="row" style="align-items:flex-start; gap:16px">
          <div class="card" style="min-width:180px; text-align:center">
            <div class="small" style="margin-bottom:6px">Profile Picture</div>
            <img
              v-if="profileForm.photoUrl"
              :src="profileForm.photoUrl"
              alt="Profile"
              style="width:120px; height:120px; object-fit:cover; border-radius:50%; border:1px solid #e2e8f0"
            />
            <div v-else class="small" style="width:120px; height:120px; display:flex; align-items:center; justify-content:center; border:1px dashed #cbd5e1; border-radius:50%">
              No photo
            </div>
            <label class="ghost" style="margin-top:8px; display:inline-block; cursor:pointer">
              <input type="file" accept="image/*" style="display:none" @change="uploadProfilePhoto" />
              Upload Photo
            </label>
          </div>

          <div style="flex:1">
            <div class="row">
              <div style="flex:1"><label>Education</label><input v-model="profileForm.education" placeholder="B.Sc. Mathematics" /></div>
              <div style="flex:1"><label>Experience</label><input v-model="profileForm.experience" placeholder="2 years tutoring" /></div>
            </div>
            <div class="row" style="margin-top:10px">
              <div style="flex:1"><label>Location (city, country)</label><input v-model="profileForm.location" placeholder="Mumbai, IN" /></div>
              <div style="flex:1">
                <label>Timezone</label>
                <select v-model="profileForm.timezone">
                  <option value="">Select timezone</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="America/New_York">America/New_York</option>
                  <option value="America/Los_Angeles">America/Los_Angeles</option>
                </select>
              </div>
            </div>
            <div class="row" style="margin-top:10px">
              <div style="flex:1">
                <label>Hourly Rate (₹/hour)</label>
                <input type="number" min="0" step="50" v-model.number="profileForm.hourlyRate" placeholder="0 = free" />
              </div>
              <div style="flex:1">
                <label>Specialties (comma separated)</label>
                <input v-model="profileSpecialties" placeholder="STEM mentor, Exam prep, Coding mentor" />
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:10px">
          <label>Bio</label>
          <textarea v-model="profileForm.bio" placeholder="About you..."></textarea>
        </div>

        <div class="row" style="margin-top:10px">
          <div style="flex:1"><label>Subjects (comma separated)</label><input v-model="profileSubjects" placeholder="Math, Science" /></div>
          <div style="flex:1"><label>Languages (comma separated)</label><input v-model="profileLanguages" placeholder="English, Hindi" /></div>
        </div>

        <div class="row" style="margin-top:10px">
          <button @click="saveProfile">Save Profile</button>
          <button class="ghost" @click="loadMyProfile">Reload My Profile</button>
        </div>
        <div v-if="profileRaw" class="card"><div class="small">Current profile (raw)</div><pre>{{ profileRaw }}</pre></div>

        <hr />
        <h3>Badges</h3>
        <div class="row" v-if="(myBadges || []).length">
          <span v-for="b in myBadges" :key="b.key" class="badge">{{ b.label }} <span class="small">({{ formatDate(b.earnedAt) }})</span></span>
        </div>
        <div v-else class="small">No badges yet.</div>
        <div class="row" style="margin-top:10px"><button class="ghost" @click="recomputeMyBadges">Recompute badges</button><button class="ghost" @click="loadMyBadges">Reload badges</button></div>
        <div v-if="myStats" class="card" style="margin-top:10px"><div class="small">Your stats</div><pre>{{ myStatsPretty }}</pre></div>

        <hr />
        <h3>Availability (pick date, toggle slots)</h3>
        <div class="row" style="align-items:center">
          <div><label>Date</label><input v-model="availDate" placeholder="YYYY-MM-DD" /></div>
          <button class="ghost" @click="loadDayAvailability">Load Day</button>
        </div>
        <div class="row" style="margin-top:10px">
          <button 
            v-for="s in slotGrid" 
            :key="s" 
            :class="['tab', daySlots.includes(s) ? 'active' : '' ]" 
            @click="toggleSlot(s)"
            :title="s"
          >
            {{ formatSlot12(s) }}
          </button>
        </div>
        <div class="row" style="margin-top:10px"><button @click="saveDayReplace">Save Day (replace)</button></div>
      </div>
    </div>



<div v-if="tab==='student'" class="card">
  <h2>Student Profile</h2>
  <p class="small" v-if="!isStudent">Login as a <b>student</b> to edit profile.</p>

  <div v-if="isStudent">
    <!-- Profile Section -->
    <div class="row" style="align-items:flex-start; gap:16px">
      <!-- Avatar -->
      <div class="card" style="min-width:180px; text-align:center">
        <div class="small" style="margin-bottom:6px">Profile Picture</div>
        <img v-if="studentForm.photoUrl"
             :src="studentForm.photoUrl"
             alt="Profile"
             style="width:120px; height:120px; object-fit:cover; border-radius:50%; border:1px solid #e2e8f0" />
        <div v-else class="small"
             style="width:120px; height:120px; display:flex; align-items:center; justify-content:center; border:1px dashed #cbd5e1; border-radius:50%">
          No photo
        </div>
        <label class="ghost" style="margin-top:8px; display:inline-block; cursor:pointer">
          <input type="file" accept="image/*" style="display:none" @change="uploadStudentPhoto" />
          Upload Photo
        </label>
      </div>

      <!-- Basic fields -->
      <div style="flex:1">
        <div class="row">
          <div style="flex:1"><label>College</label><input v-model="studentForm.college" placeholder="IIT Bombay" /></div>
          <div style="flex:1"><label>Course</label><input v-model="studentForm.course" placeholder="B.Tech CSE" /></div>
        </div>
        <div class="row" style="margin-top:10px">
          <div style="flex:1"><label>Year</label><input v-model="studentForm.year" placeholder="2nd Year" /></div>
          <div style="flex:1"><label>Interests (comma separated)</label><input v-model="studentInterests" placeholder="Math, AI, Web Dev" /></div>
        </div>
      </div>
    </div>

    <div style="margin-top:10px">
      <label>Bio</label>
      <textarea v-model="studentForm.bio" placeholder="Tell something about yourself..."></textarea>
    </div>

    <div class="row" style="margin-top:10px">
      <button @click="saveStudentProfile">Save Profile</button>
      <button class="ghost" @click="loadMyStudentProfile">Reload My Profile</button>
    </div>

    <div v-if="studentRaw" class="card" style="margin-top:10px">
      <div class="small">Current profile (raw)</div>
      <pre>{{ studentRaw }}</pre>
    </div>

    <!-- Book Session Section -->
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
          :class="['tab', selectedSlot===s ? 'active' : '']"
          @click="selectedSlot = s"
          :title="s"
        >
          {{ formatSlot12(s) }}
        </button>
      </div>
      <!-- Show message + Book button only if slot selected -->
      <div v-if="selectedSlot" style="margin-top:12px">
        <label>Message to volunteer</label>
        <input v-model="bookingMessage" placeholder="Write a message (optional)" />
        <div class="row" style="margin-top:8px">
          <button @click="bookSlotAsStudent">Book Session</button>
        </div>
      </div>
      <div class="small" v-if="!bookSlots.length">No slots for selected date.</div>
    </div>
  </div>
</div>


<!-- EXPLORE -->
<div v-if="tab==='explore'" class="card">
  <!-- Heading -->
  <h2 v-if="isStudent">Explore Volunteers</h2>
  <h2 v-if="isVolunteer">Explore Students</h2>

  <!-- Search bar -->
  <div class="row">
    <div style="flex:1">
      <label>{{ isStudent ? 'Filter by subject' : 'Search by Student UserId' }}</label>
      <input v-model="exploreId" :placeholder="isStudent ? 'e.g. Math' : 'paste student userId'" />
    </div>
    <button @click="loadExploreById">Search</button>
  </div>

  <!-- Extra filter for subject/interest -->
  <div class="row" style="margin-top:10px">
    <div style="flex:1">
      <label>{{ isStudent ? 'Filter by subject' : 'Filter by interest' }}</label>
      <input v-model="exploreSubject" :placeholder="isStudent ? 'e.g. Math' : 'e.g. Web Dev'" />
    </div>
    <button @click="loadExplore">Apply Filter</button>
  </div>

  <!-- Results (replace existing block) -->
<div class="row" style="margin-top:10px;">
  <div
    v-for="p in exploreResults"
    :key="p._id || p.userId"
    class="card"
    style="flex:1; min-width:260px;"
    @mouseenter="preloadProfile(p.userId, p.role || (isStudent ? 'volunteer' : 'student'))"
  >
    <div class="row" style="gap:10px; align-items:center">
      <img
        v-if="p.photoUrl || p.profilePicture?.url || p.avatar?.url"
        :src="p.photoUrl || p.profilePicture?.url || p.avatar?.url"
        alt="Profile"
        style="width:52px; height:52px; border-radius:50%; object-fit:cover; border:1px solid #e2e8f0"
      />
      <div style="flex:1">
        <div style="display:flex; align-items:center; gap:8px;">
          <!-- clickable name opens full profile -->
          <a
            class="user-name clickable"
            @click.prevent="openProfile(p.userId, p.role || (isStudent ? 'volunteer' : 'student'))"
          >
            <b>{{ p.name || p.userId || (isStudent ? 'Volunteer' : 'Student') }}</b>
          </a>
          <span class="badge">{{ p.role || (isStudent ? 'volunteer' : 'student') }}</span>
        </div>
        <div class="small">userId: {{ p.userId }}</div>
      </div>
    </div>

    <!-- Student exploring volunteers -->
    <div v-if="isStudent">
      <div class="small" style="margin-top:6px">
        <span v-if="p.location">{{ p.location }}</span>
        <span v-if="p.timezone"> • {{ p.timezone }}</span>
        <span v-if="p.hourlyRate !== undefined"> • ₹{{ p.hourlyRate }}/hr</span>
      </div>
      <div>Subjects: {{ (p.subjects||[]).join(", ") }}</div>
      <div v-if="(p.specialties||[]).length" class="small">Specialties: {{ p.specialties.join(", ") }}</div>
      <div>Bio: {{ p.bio || '-' }}</div>
      <div class="row" style="margin-top:8px">
        <button v-if="user && user._id !== p.userId" @click="startChatWith(p.userId)">Message</button>
        <button v-if="user && !isFollowingId(p.userId) && user._id !== p.userId" @click="followUser(p.userId)">Follow</button>
        <button v-if="user && isFollowingId(p.userId)" class="ghost" @click="unfollowById(p.userId)">Unfollow</button>
      </div>
    </div>

    <!-- Volunteer exploring students -->
    <div v-if="isVolunteer">
      <div>Interests: {{ (p.interests||[]).join(", ") }}</div>
      <div v-if="p.bio">Bio: {{ p.bio }}</div>
      <div class="row" style="margin-top:8px">
        <button @click="sendSessionRequestToStudent(p.userId)">Send Session Request</button>
        <button class="ghost" @click="startChatWith(p.userId)">Message</button>
      </div>
    </div>
  </div>
</div>



  <!-- Volunteer quick send (only visible for volunteers) -->
  <!-- Volunteer quick send: choose from YOUR availability -->
  <div v-if="isVolunteer" class="card" style="margin-top:12px">
    <h3 style="margin:0 0 8px 0">Send session request to student</h3>

    <div class="row" style="align-items:flex-start; gap:12px">
      <div style="flex:2">
        <label>Student UserId</label>
        <input v-model="exploreStudentId" placeholder="paste student userId" />
      </div>

      <div style="flex:3">
        <label>Message</label>
        <textarea v-model="exploreStudentMessage" placeholder="Write a short message (optional)"></textarea>
      </div>

      <div style="display:flex; align-items:flex-end; gap:8px">
        <button @click="loadMyVolunteerAvailability">Load my availability</button>
        <button @click="sendSessionRequestToStudentFromInput">Send Request</button>
      </div>
    </div>

    <!-- Availability chooser (shows after load) -->
    <div v-if="exploreVolunteerAvail.length" style="margin-top:12px">
      <div class="small">Pick date (from your availability):</div>
      <div class="row" style="margin-top:8px">
        <button
          v-for="d in exploreVolunteerAvail.map(x => x.date)"
          :key="d"
          :class="['tab', exploreStudentDate===d ? 'active' : '']"
          @click="onPickExploreDate(d)"
        >
          {{ d }}
        </button>
      </div>

      <div v-if="exploreBookSlots.length" style="margin-top:8px">
        <div class="small">Pick time slot:</div>
        <div class="row" style="margin-top:6px; gap:8px; flex-wrap:wrap">
          <button
            v-for="s in exploreBookSlots"
            :key="s"
            :class="['tab', exploreStudentTime===s ? 'active' : '']"
            @click="exploreStudentTime = s"
            :title="s"
          >
            {{ formatSlot12(s) }}
          </button>
        </div>
      </div>

      <div v-else class="small" style="margin-top:8px">Select a date to see slots.</div>
    </div>
  </div>
</div>


    <!-- STATS -->
    <div v-if="tab==='stats'" class="card">
      <h2>Session Stats (Dashboard)</h2>
      <p class="small">Shows metrics for the selected volunteer. By default: your own profile when logged in.</p>
      <div class="row" style="align-items:flex-end">
        <div style="flex:2"><label>Volunteer userId</label><input v-model="statsVolunteerId" :placeholder="user ? user._id : 'paste volunteer userId'" /></div>
        <button @click="loadDashboard">Load Dashboard</button>
      </div>
      <div v-if="dashboard" style="margin-top:12px">
        <div class="row" style="gap:10px; flex-wrap:wrap">
          <div class="card" style="flex:1; min-width:180px;"><div class="small">Sessions Taught</div><div class="stat">{{ dashboard.metrics.sessionsTaught }}</div></div>
          <div class="card" style="flex:1; min-width:180px;"><div class="small">Students Helped</div><div class="stat">{{ dashboard.metrics.studentsHelped }}</div></div>
          <div class="card" style="flex:1; min-width:180px;"><div class="small">Avg. Rating</div><div class="stat">{{ dashboard.metrics.avgRating?.toFixed ? dashboard.metrics.avgRating.toFixed(2) : dashboard.metrics.avgRating }} <span class="small">({{ dashboard.metrics.ratingsCount }} ratings)</span></div></div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Badges</h3>
          <div class="row" v-if="(dashboard.badges || []).length">
            <span v-for="b in dashboard.badges" :key="b.key" class="badge">{{ b.label }} <span class="small">({{ formatDate(b.earnedAt) }})</span></span>
          </div>
          <div v-else class="small">No badges yet.</div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Subjects (by sessions)</h3>
          <div v-if="(dashboard.subjects||[]).length">
            <div v-for="s in dashboard.subjects" :key="s.subject" class="row" style="justify-content:space-between"><div>{{ s.subject }}</div><div>{{ s.count }}</div></div>
          </div>
          <div v-else class="small">No subject data yet.</div>
        </div>
        <div class="row" style="margin-top:12px; align-items:flex-start">
          <div class="card" style="flex:1; min-width:280px;">
            <h3>Upcoming Sessions</h3>
            <div v-if="!(dashboard.upcoming||[]).length" class="small">No upcoming sessions.</div>
            <div v-for="s in dashboard.upcoming" :key="s._id" class="row" style="justify-content:space-between"><div>{{ s.date }} {{ s.time }}</div><a v-if="s.zoomLink" :href="s.zoomLink" target="_blank">Join</a></div>
          </div>
          <div class="card" style="flex:1; min-width:280px;">
            <h3>Recent Reviews</h3>
            <div v-if="!(dashboard.recentReviews||[]).length" class="small">No reviews yet.</div>
            <div v-for="r in dashboard.recentReviews" :key="r._id" class="row" style="justify-content:space-between">
              <div><div><b>{{ r.author?.name || 'Anonymous' }}</b> — {{ r.rating }}/5</div><div class="small">{{ r.comment || '-' }}</div></div>
              <div class="small">{{ formatDate(r.createdAt) }}</div>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Recent Sessions (most recent first)</h3>
          <div v-if="!(dashboard.recentSessions||[]).length" class="small">No sessions yet.</div>
          <div v-for="s in dashboard.recentSessions" :key="s._id" class="row" style="justify-content:space-between"><div>{{ s.subject }}</div><div class="small">{{ s.date }} {{ s.time }}</div></div>
        </div>
      </div>
      <div v-else class="small" style="margin-top:12px">Load a volunteer id to see the dashboard.</div>
    </div>

    <!-- REQUESTS -->
<div v-if="tab==='sessions'" class="card">
  <h2>My Session Requests</h2>
  <div class="row"><button @click="loadMyRequests">Reload</button></div>

  <div v-if="!visibleRequests.length" class="small" style="margin-top:8px">No active requests.</div>

  <RequestItem
    v-for="r in visibleRequests"
    :key="r._id"
    :request="r"
    :isVolunteer="isVolunteer"
    :currentUserId="user?._id || ''"
    @accepted="acceptSession"
    @rejected="(req) => respondToRequest(req, 'rejected')"
    @cancel="cancelSession"
    @join="(req) => joinSession(req._id)"
    @started="(payload) => {
      // optional: toast/log when timer hits 0
      console.log('Session started:', payload)
    }"
  />
</div>


<div v-if="tab==='notifications'" class="card">
  <h2>Notifications</h2>
  <div class="row"><button @click="loadNotifications">Reload</button></div>
  <div v-for="n in notifications" :key="n._id" class="card">
    <div class="small">
      Type: <b>{{ n.type }}</b>
      <span v-if="!n.read" class="badge">new</span>
    </div>
    <div class="small">
      From: <b>{{ n.payload?.actorName || n.payload?.senderName || 'Unknown' }}</b>
      <span class="small">({{ n.payload?.actorRole || '' }})</span>
    </div>
    <div class="small">Subject: {{ n.payload?.subject || '-' }}</div>
    <div class="small">Message: {{ n.payload?.message || '-' }}</div>

    <div v-if="n.type==='session_request'" class="small">
      Proposed: {{ n.payload?.proposedDate }} {{ n.payload?.proposedTime }}
    </div>

    <div v-if="n.type==='session_update'" class="small">
      Status: <b>{{ n.payload?.status }}</b>
      <template v-if="n.payload?.finalDate || n.payload?.finalTime">
        • Final: {{ n.payload?.finalDate }} {{ n.payload?.finalTime }}
        <a v-if="n.payload?.zoomLink" :href="n.payload.zoomLink" target="_blank">Join</a>
      </template>
    </div>

    <div class="row" style="margin-top:6px; gap: 6px;">
      <button v-if="!n.read" @click="markNotifRead(n._id)">Mark read</button>
      <button 
        v-if="n.payload?.sessionId && ['session_update', 'session_accepted', 'session_scheduled'].includes(n.type)" 
        @click="joinSession(n.payload.sessionId)"
        class="primary"
      >
        Join Now
      </button>
    </div>
  </div>
</div>

    <!-- REVIEW -->
    <div v-if="tab==='review'" class="card">
      <h2>Post a Review</h2>
      <p class="small">Use a student/admin token to review a volunteer (enter volunteer's userId).</p>
      <div class="row">
        <div style="flex:2"><label>Volunteer UserId</label><input v-model="reviewForm.volunteerId" placeholder="volunteer userId" /></div>
        <div style="flex:1"><label>Rating (1-5)</label><input type="number" min="1" max="5" v-model.number="reviewForm.rating" /></div>
      </div>
      <div style="margin-top:10px"><label>Comment</label><textarea v-model="reviewForm.comment" placeholder="Your feedback..."></textarea></div>
      <div class="row" style="margin-top:10px"><button @click="postReview">Submit Review</button></div>
      <div v-if="lastResponse" class="card" style="margin-top:12px"><div class="small">Last response</div><pre>{{ lastResponse }}</pre></div>
    </div>

   <!-- CHATS --> <div v-if="tab==='chats'" class="card"> <h2>Chats</h2> <div class="row" style="align-items:flex-start; gap:12px"> <!-- Conversation list --> <div class="card" style="flex:1; min-width:260px; max-width:320px;"> <div class="row" style="justify-content:space-between; align-items:center"> <h3>Conversations</h3> <button class="ghost" @click="loadConversations">Reload</button> </div> <div v-if="!conversations.length" class="small">No conversations yet.</div> <div v-for="c in conversations" :key="c._id" class="row" :style="{ justifyContent:'space-between', alignItems:'center', background: activeConv && activeConv._id===c._id ? '#e9eef7':'transparent', padding:'6px', borderRadius:'8px', cursor:'pointer' }" @click="openConversation(c)" > <div> <div class="small">#{{ c._id.slice(-6) }} <span v-if="c.sessionRequest" class="badge">session</span></div> <div>{{ c.lastMessage || '—' }}</div> <div class="small">{{ new Date(c.lastMessageAt).toLocaleString() }}</div> <div class="small" v-if="displayPeer(c)"> with: <b>{{ displayPeer(c) }}</b> <span v-if="displayPeerRole(c)" class="badge">{{ displayPeerRole(c) }}</span> </div> </div> <div> <span v-if="c.unread>0" class="badge">{{ c.unread }}</span> </div> </div> </div> <!-- Message pane --> <div class="card" style="flex:2; min-height:380px;"> <div v-if="!activeConv" class="small">Open a conversation or start one from Explore/People/Requests.</div> <div v-else> <!-- Header with peer name + role --> <div class="row" style="justify-content:space-between; align-items:center"> <div> <b>{{ peerDisplay }}</b> <span v-if="peerRole" class="badge">{{ peerRole }}</span> </div> <div class="small"> conv: {{ activeConv._id }} <span v-if="activeConv.sessionRequest" class="badge">session</span> </div> </div> <!-- Chat window with clearer background --> <div ref="scrollBox" style="margin-top:10px; height:320px; overflow:auto; border:1px solid #e2e8f0; border-radius:10px; padding:10px; background:#f7f9fc;"> <div v-for="m in messages" :key="m._id" :style="{ display:'flex', justifyContent: (String(m.sender)===String(user?._id)) ? 'flex-end':'flex-start' }"> <div :style="{ maxWidth: '78%', padding: '8px 12px', borderRadius: '12px', backgroundColor: (String(m.sender)===String(user?._id)) ? '#e3f2fd' : '#f1f1f1', margin: '4px 0', wordBreak: 'break-word' }"> {{ m.text || '' }} <!-- attachments --> <div v-if="m.attachments && m.attachments.length" style="margin-top:6px"> <div v-for="(att,idx) in m.attachments" :key="idx" style="margin-top:6px"> <template v-if="att.mime && att.mime.startsWith('image/')"> <a :href="fileURL(att.url)" target="_blank" class="small">Image: {{ att.name }}</a> <div style="margin-top:4px"> <img :src="fileURL(att.url)" alt="" style="max-width:220px; max-height:160px; border-radius:8px; border:1px solid #e2e8f0" /> </div> </template> <template v-else> <a :href="fileURL(att.url)" target="_blank" class="small">Download: {{ att.name }}</a> <div class="small" style="opacity:.7"> {{ att.mime }} • {{ (att.size/1024).toFixed(1) + ' KB' }} </div> </template> </div> </div> <div class="small" style="opacity:.7; margin-top:4px; text-align:right"> {{ new Date(m.createdAt).toLocaleTimeString() }} </div> </div> </div> </div> <!-- Pending attachments preview --> <div v-if="pendingUploads.length" class="card soft" style="margin-top:8px;"> <div class="row" style="justify-content:space-between; align-items:center"> <div class="small">Attachments to send ({{ pendingUploads.length }})</div> <button class="ghost" @click="clearPendingUploads">Clear</button> </div> <div class="row" style="flex-wrap:wrap; gap:8px; margin-top:6px"> <div v-for="(a,i) in pendingUploads" :key="i" class="card tiny"> <div class="small">{{ a.name }}</div> <div class="small" style="opacity:.7">{{ formatSize(a.size) }}</div> <div class="small">{{ a.mime }}</div> </div> </div> </div> <!-- Composer --> <div class="row" style="margin-top:8px; gap:8px; align-items:center"> <input v-model="draft" placeholder="Type a message..." @keyup.enter="sendMessage" style="flex:1" /> <label class="ghost" style="padding:6px 10px; cursor:pointer"> <input type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx" style="display:none" @change="onPickFiles" /> 📎 Attach </label> <button :disabled="isUploading" @click="sendMessage">{{ isUploading ? 'Uploading...' : 'Send' }}</button> </div> </div> </div> </div> </div>

    <!-- STUDENT PROGRESS -->
    <div v-if="tab==='studentProgress'" class="card">
      <h2>My Learning Progress</h2>
      <div class="row" style="gap:12px; flex-wrap:wrap">
        <div class="card" style="min-width:180px">
          <div class="small">Total sessions</div>
          <div class="stat">{{ progress.totalSessions || 0 }}</div>
        </div>
        <div class="card" style="min-width:180px">
          <div class="small">Completed sessions</div>
          <div class="stat">{{ progress.completedSessions || 0 }}</div>
        </div>
        <div class="card" style="min-width:180px">
          <div class="small">Hours learned</div>
          <div class="stat">{{ progress.hoursLearned || 0 }}</div>
        </div>
        <div class="card" style="min-width:180px">
          <div class="small">Weekly streak (days)</div>
          <div class="stat">{{ progress.weeklyStreak || 0 }}</div>
        </div>
      </div>

      <div style="margin-top:12px">
        <h3>Top subjects</h3>
        <div v-if="(progress.subjects || []).length">
          <div v-for="s in progress.subjects" :key="s.subject" class="row" style="justify-content:space-between">
            <div>{{ s.subject }}</div><div class="small">{{ s.count }}</div>
          </div>
        </div>
        <div v-else class="small">No subject data yet.</div>
      </div>

      <div style="margin-top:12px">
        <h3>Upcoming sessions</h3>
        <div v-if="(progress.scheduledSessions || []).length">
          <div v-for="ss in progress.scheduledSessions" :key="ss._id" class="row" style="justify-content:space-between">
            <div>{{ ss.subject }} — {{ ss.date }} {{ ss.time }}</div>
            <div class="small">Volunteer: {{ ss.volunteer?.name || ss.volunteer }}</div>
          </div>
        </div>
        <div v-else class="small">No upcoming sessions.</div>
      </div>

      <div style="margin-top:12px">
        <h3>Badges</h3>
        <div v-if="(progress.badges || []).length">
          <span v-for="b in progress.badges" :key="b.key" class="badge">{{ b.label }}</span>
        </div>
        <div v-else class="small">No badges yet.</div>
      </div>
    </div>
</div>




<!-- FULL PROFILE MODAL -->
<div v-if="selectedProfile" class="profile-modal-backdrop" @click.self="closeProfile">
  <div class="profile-modal card">
    <!-- Header -->
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; gap:12px; align-items:center;">
        <img
          v-if="selectedProfile.photoUrl || selectedProfile.profilePicture?.url || selectedProfile.avatar?.url"
          :src="selectedProfile.photoUrl || selectedProfile.profilePicture?.url || selectedProfile.avatar?.url"
          alt="profile"
          style="width:60px; height:60px; border-radius:50%; object-fit:cover;"
        />
        <div>
          <h2 style="margin:0">{{ selectedProfile.name || 'No name' }}</h2>
          <div class="small" style="margin-top:4px">
            {{ selectedProfile.role || 'User' }} • {{ selectedProfile.userId || selectedProfile._id }}
          </div>
        </div>
      </div>

      <div style="display:flex; gap:8px; align-items:center;">
        <div v-if="user && (selectedProfile.userId || selectedProfile._id) !== user._id" class="row" style="gap:8px">
          <button class="primary" @click="startVideoCall(selectedProfile.userId || selectedProfile._id)">
            <span style="display:inline-flex; align-items:center; gap:4px">
              <span>🎥</span> Video Call
            </span>
          </button>
        </div>
        <button class="ghost" @click="closeProfile">Close</button>
      </div>
    </div>

    <hr />

    <!-- Role-specific rendering -->
    <div v-if="selectedProfile.role === 'volunteer'">
      <VolunteerProfile
        :profile="selectedProfile"
        :reviews="currentProfileReviews"
        @start-call="startVideoCall"
      />
    </div>

    <div v-else-if="selectedProfile.role === 'student'">
      <StudentProfile :profile="selectedProfile" />
    </div>

    <!-- Fallback layout when role unknown -->
    <div v-else style="margin-top:8px">
      <div style="display:flex; gap:18px; margin-top:8px; flex-wrap:wrap;">
        <div style="flex:1; min-width:260px">
          <div><b>About</b></div>
          <div class="small">{{ selectedProfile.bio || '-' }}</div>

          <div style="margin-top:8px"><b>Location / Timezone</b></div>
          <div class="small">
            {{ typeof selectedProfile.location === 'string'
              ? selectedProfile.location
              : ([selectedProfile.location?.city, selectedProfile.location?.state, selectedProfile.location?.country]
                  .filter(Boolean)
                  .join(', '))
              || '-' }}
            {{ selectedProfile.timezone ? (' • ' + selectedProfile.timezone) : '' }}
          </div>

          <div style="margin-top:8px"><b>Subjects / Interests</b></div>
          <div class="small">{{ (selectedProfile.subjects || selectedProfile.interests || []).join(', ') || '-' }}</div>
        </div>

        <div style="flex:1; min-width:260px">
          <div><b>Extras</b></div>
          <div class="small">
            Hourly rate:
            {{ selectedProfile.hourlyRate !== undefined && selectedProfile.hourlyRate !== null ? ('₹' + selectedProfile.hourlyRate + '/hr') : '-' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Video Call Panel -->
<div v-if="user && showCallRoom" class="card" style="margin-top:20px;">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <h2 style="margin:0">Video Call</h2>
    <button class="ghost" @click="() => { showCallRoom = false; callRoomSession = null }">Close</button>
  </div>

  <CallRoom
    :room-id="callRoomId"
    :user-info="myUserInfo"
    :ws-url="WS_URL"
    :token="token"
    :session-id="callRoomSession?._id || callRoomSession?.id"
    :external-join-link="callRoomSession?.final?.zoomLink || callRoomSession?.zoomLink || null"
    @left="handleLeaveCall"
    @error="(e) => console.warn('Call error', e)"
  />
</div>


</template>
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { io } from 'socket.io-client'
import VolunteerProfile from './components/VolunteerProfile.vue'
import RequestItem from './components/RequestItem.vue'
import StudentProfile from './components/StudentProfile.vue'
import CallRoom from './components/CallRoom.vue'
import { localDateTimeToIso, getClientTzOffsetMinutes } from './utils/datetime'


const API = 'http://localhost:5000/api'

// ---------- auth state ----------
const token = ref(localStorage.getItem('token') || '')
const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))
const tab = ref('auth')
const lastResponse = ref('')
const exploreStudentId = ref('')         // volunteer -> student search box
const exploreStudentMessage = ref('')    // message volunteer types
const exploreStudentDate = ref('')    // yyyy-mm-dd or leave empty
const exploreStudentTime = ref('')    // e.g. 10:00 or empty
const exploreVolunteerAvail = ref([])  // for storing loaded availability
const exploreBookSlots = ref([])       // for slots of the selected date
const notifTotalUnread = ref(0)   
const showProfileModal = ref(false)
const currentProfile = ref(null)
const currentProfileType = ref('') // 'volunteer' or 'student'
const currentProfileReviews = ref([]) // for volunteer reviews

// --- Call UI state (Zoom + in-app) ---
const showCallRoom = ref(false)
const callRoomSession = ref(null) // holds the session object we're joining (if any)

// computed room id: prefer real session id, else DM room between two users
const callRoomId = computed(() => {
  const s = callRoomSession.value
  if (s && (s._id || s.id)) return String(s._id || s.id)       // stable for a session
  // ad-hoc: if you ever call startVideoCall(targetUserId) without a session
  return user.value ? String(user.value._id) : 'room'
})

// convenience: pass user info into CallRoom
const myUserInfo = computed(() => ({
  id: user.value?._id || null,
  name: user.value?.name || 'User'
}))


// forms
const signupForm = reactive({ name: '', email: '', password: '', role: 'volunteer' })
const loginForm = reactive({ email: '', password: '' })

// volunteer profile (old UI + extended fields)
const profileForm = reactive({
  education: '',
  experience: '',
  bio: '',
  subjects: [],
  languages: [],
  hourlyRate: 0,
  location: '',
  timezone: '',
  specialties: [],
  photoUrl: '' // URL (Cloudinary)
})
const profileRaw = ref('')
const profileSubjects = ref('')
const profileLanguages = ref('')
const profileSpecialties = ref('')

// ---------- student profile ----------
const studentForm = reactive({
  college: '',
  course: '',
  year: '',
  interests: [],
  bio: '',
  photoUrl: ''
})
const studentRaw = ref('')
const studentInterests = ref('')

async function loadMyStudentProfile() {
  if (!user.value) return;

  // helper to clear the form so no stale data remains
  const resetStudentForm = () => {
    studentForm.college  = '';
    studentForm.course   = '';
    studentForm.year     = '';
    studentForm.bio      = '';
    studentForm.photoUrl = '';
    studentInterests.value = '';
    studentRaw.value = '';
  };

  try {
    const data = await api('/students/me', { method: 'GET' });
    // Some backends return {message: "..."} on empty; guard for that
    if (!data || data.message) {
      resetStudentForm();
      return; // no alert — just show empty form for new user
    }

    studentRaw.value      = JSON.stringify(data, null, 2);
    const p               = data || {};
    studentForm.college   = p.college || '';
    studentForm.course    = p.course || '';
    studentForm.year      = p.year || '';
    studentForm.bio       = p.bio || '';
    studentForm.photoUrl  = p.profilePicture?.url || p.photoUrl || '';
    studentInterests.value = (p.interests || []).join(', ');
  } catch (e) {
    // If server returns 404 / not found, silently reset instead of alerting
    const msg = String(e?.message || '');
    if (msg.includes('404') || /not found/i.test(msg)) {
      resetStudentForm();
      return;
    }
    console.error('loadMyStudentProfile failed', e);
    alert(e.message);
  }
}

async function saveStudentProfile() {
  try {
    const payload = {
      college: studentForm.college,
      course: studentForm.course,
      year: studentForm.year,
      bio: studentForm.bio,
      interests: studentInterests.value.split(',').map(s => s.trim()).filter(Boolean),
    }
    const data = await api('/students/me', { method: 'PUT', body: JSON.stringify(payload) })
    studentRaw.value = JSON.stringify(data, null, 2)
    alert('Student profile saved')
  } catch (e) { alert(e.message) }
}

const studentFile = ref(null)

async function uploadStudentPhoto(evt) {
  const file = evt.target.files?.[0]
  if (!file) return alert("Select file first")

  try {
    const fd = new FormData()
    fd.append("photo", file) // backend expects field name "photo"
    const data = await api('/students/me/photo', { method: 'POST', body: fd })

    studentForm.photoUrl = data.profilePicture?.url || ''
    await loadMyStudentProfile()
    alert("Photo uploaded!")
  } catch (err) {
    console.error("Upload failed:", err)
    alert(err.message || "Upload failed")
  } finally {
    evt.target.value = '' // reset input
  }
}


// sessions
const myRequests = ref([])
const visibleRequests = computed(() => 
  (myRequests.value || []).filter(r => r.status !== 'cancelled')
);
const acceptDate = ref('2025-08-27')
const acceptTime = ref('10:30')
const manualTargetId = ref('')  // For session request form
const requestSubject = ref('')  // For session request form

// student progress
const progress = ref({});

// notifications
const notifications = ref([])

// === Unread notifications count (for red dot/badge) ===
const unreadNotifs = computed(() => (notifications.value || []).filter(n => !n.read).length);

// reviews
const reviewForm = reactive({ volunteerId: '', rating: 5, comment: '' })

// badges
const myBadges = ref([])
const myStats = ref(null)
const myStatsPretty = computed(() => myStats.value ? JSON.stringify(myStats.value, null, 2) : '')

// people
const followers = ref([])
const following = ref([])
const followingSet = ref(new Set())
const followTargetId = ref('')

// stats dashboard
const dashboard = ref(null)
const statsVolunteerId = ref('')

// chats
const socket = ref(null)
const conversations = ref([])
const activeConv = ref(null)
const messages = ref([])
const draft = ref('')
const scrollBox = ref(null)

// attachments
const pendingUploads = ref([]) // [{url,name,mime,size}]
const isUploading = ref(false)

const isVolunteer = computed(() => user.value && user.value.role === 'volunteer')
const isStudent   = computed(() => user.value && user.value.role === 'student')
const isAdmin     = computed(() => user.value && user.value.role === 'admin')

// ------- peer display for chat header -------
const peer = computed(() => {
  if (!activeConv.value || !user.value) return null
  const arr = activeConv.value.participants || []
  const other = arr.find(p => String(p._id || p) !== String(user.value._id))
  return other || null
})
const peerDisplay = computed(() => {
  if (!peer.value) return 'Conversation'
  if (typeof peer.value === 'string') return peer.value
  return peer.value.name || 'User'
})
const peerRole = computed(() => {
  if (!peer.value || typeof peer.value === 'string') return ''
  return peer.value.role || ''
})

// ---- helpers ----
function fileURL(u) {
  if (!u) return ''
  return /^https?:\/\//i.test(u) ? u : `${WS_URL}${u}`
}

// human-friendly file size (KB)
const formatSize = (sizeInBytes) => {
  try {
    const s = Number(sizeInBytes) || 0;
    return (s / 1024).toFixed(1) + ' KB';
  } catch {
    return '0 KB';
  }
};

// Explore card – accept both shapes (profilePicture|avatar)
function volPhoto(v) {
  return v.photoUrl
    || (v.profilePicture && v.profilePicture.url)
    || (v.avatar && v.avatar.url)
    || ''
}

// === Unread notifications badge ===
const notifUnread = computed(() =>
  (notifications.value || []).filter(n => !n.read).length
)

// === Helpers to know if current user is the RECEIVER of a request ===
function amReceiver(r) {
  try {
    if (!r || !user.value) return false;
    const myId = String(user.value._id);
    const senderId = r.requestedBy?._id ? String(r.requestedBy._id) : null;
    const receiverId = r.receiver?._id ? String(r.receiver._id) : null;
    return (receiverId === myId) || (senderId !== myId && r.volunteer?._id === myId);
  } catch (e) {
    console.warn('amReceiver error:', e);
    return false;
  }
}

const canAccept = (r) => amReceiver(r) && r.status === 'pending';
const canReject = (r) => amReceiver(r) && r.status === 'pending';

// Unified request response handler
async function respondToRequest(rOrId, action) {
  try {
    if (!['accepted','rejected'].includes(action)) return;
    if (!user.value) return alert('Login first');

    const requestId = typeof rOrId === 'string' ? rOrId : (rOrId && (rOrId._id || rOrId.id));
    if (!requestId) return alert('Cannot perform action: missing id');

    if (action === 'accepted') {
      // Use the accept endpoint for accepting requests
      await api(`/sessions/${requestId}/accept`, { 
        method: 'POST',
        body: JSON.stringify({}) 
      });
    } else {
      // Use the respond endpoint for rejecting requests (backend expects POST)
      await api(`/sessions/${requestId}/respond`, { 
        method: 'POST',
        body: JSON.stringify({ action: 'rejected' }) 
      });
    }

    // Refresh the UI
    await loadMyRequests();
    await loadNotifications();
    alert(`Request ${action}.`);
  } catch (e) {
    console.error('respondToRequest error', e);
    alert(e.message || 'Failed to update request');
  }
}

async function handleReviewSubmitted(reviewData) {
  if (!selectedProfile.value) return { success: false, error: 'No profile selected' };
  
  try {
    // Assuming your API expects { volunteerId, rating, comment }
    const response = await api('/reviews', {
      method: 'POST',
      body: JSON.stringify({
        volunteerId: selectedProfile.value.userId || selectedProfile.value._id,
        rating: reviewData.rating,
        comment: reviewData.comment
      })
    });
    
    // Refresh reviews
    if (currentProfileType.value === 'volunteer') {
      const data = await api(`/volunteers/${selectedProfile.value.userId || selectedProfile.value._id}`);
      currentProfileReviews.value = data.reviews || [];
    }
    
    return { success: true };
  } catch (error) {
    console.error('Failed to submit review:', error);
    return { success: false, error: error.message };
  }
}

async function acceptSession(sessionOrId, scheduleData = {}) {
  const id = typeof sessionOrId === 'string'
    ? sessionOrId
    : (sessionOrId && (sessionOrId._id || sessionOrId.id));

  if (!user.value) return alert('Login first');
  if (!id) return alert('Cannot accept. Session id missing.');

  try {
    // If we have schedule data, validate and convert to proper ISO string
    let scheduledAt = null;
    let tzOffsetMin = null;
    
    if (scheduleData.date && scheduleData.time) {
      const sched = localDateTimeToIso(scheduleData.date, scheduleData.time);
      if (!sched) {
        throw new Error('Could not build scheduled time from date/time');
      }
      scheduledAt = sched.iso;
      tzOffsetMin = getClientTzOffsetMinutes();
    }

    // Prepare the request body
    const body = {};
    if (scheduledAt) {
      body.scheduledAt = scheduledAt;
      body.tzOffsetMin = tzOffsetMin;
    }

    // Decide endpoint by role
    if (user.value.role === 'student') {
      // student accepts -> respond API
      await api(`/sessions/${id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ 
          action: 'accepted',
          ...(scheduledAt && { scheduledAt, tzOffsetMin })
        })
      });
    } else {
      // volunteer/admin accepts -> accept API
      await api(`/sessions/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    }

    await loadMyRequests();
    await loadNotifications();
    
    if (scheduledAt) {
      alert(`Session accepted and scheduled for ${new Date(scheduledAt).toLocaleString()}`);
    } else {
      alert('Session accepted');
    }
  } catch (err) {
    console.error('acceptSession error', err);
    alert(err?.message || 'Failed to accept session');
  }
}


// --------- api (supports FormData) ---------
async function api(path, options = {}) {
  const url = `${API}${path}`

  // read token directly from localStorage to avoid stale ref across tabs
  const storedToken = localStorage.getItem('token') || ''

  const isFD = options.body instanceof FormData
  const headers = {
    ...(options.headers || {}),
    ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
  }
  if (!isFD) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, { ...options, headers, body: options.body })
  // handle 401 explicitly so callers can react
  if (res.status === 401) {
    // clear local auth state to avoid repeated 401s and inform user
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    // optional: switch to auth tab
    tab.value = 'auth'
    throw new Error('Unauthorized')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || 'Request failed')
  return data
}

function resetAllOnAuthChange() {
  // student form
  studentForm.college = '';
  studentForm.course = '';
  studentForm.year = '';
  studentForm.bio = '';
  studentForm.photoUrl = '';
  studentInterests.value = '';
  studentRaw.value = '';

  // volunteer form
  profileForm.education = '';
  profileForm.experience = '';
  profileForm.bio = '';
  profileForm.subjects = [];
  profileForm.languages = [];
  profileForm.hourlyRate = 0;
  profileForm.location = '';
  profileForm.timezone = '';
  profileForm.specialties = [];
  profileForm.photoUrl = '';
  profileSubjects.value = '';
  profileLanguages.value = '';
  profileSpecialties.value = '';
}

function setAuth(t, u) {
  token.value = t;
  user.value = u;
  localStorage.setItem('token', t);
  localStorage.setItem('user', JSON.stringify(u));
  resetAllOnAuthChange();
  connectSocket();
}

function logout() {
  token.value = '';
  user.value = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (socket.value) socket.value.disconnect();
  resetAllOnAuthChange();
}

function switchTab(t) {
  tab.value = t;
  // eager loads for each tab
  if (t === 'notifications') loadNotifications();
  if (t === 'chats') loadConversations();
  if (t === 'people') loadNetwork();
  if (t === 'sessions') loadMyRequests();
  if (t === 'stats') { statsVolunteerId.value = user.value ? user.value._id : ''; loadDashboard(); }
  if (t === 'explore') loadExplore();
  if (t === 'volunteer') { if (isVolunteer.value) { loadMyProfile(); loadDayAvailability(); loadMyBadges(); } }
  if (t === 'student') { if (isStudent.value) loadMyStudentProfile(); }
  if (t === 'studentProgress') loadMyProgress();
  // keep viewport top
  window.scrollTo(0, 0);
}

function formatDate(d) { try { return new Date(d).toLocaleDateString() } catch { return d } }

// --- 24h -> 12h helpers ---
function to12h(hhmm = '') {
  const [hStr, mStr] = String(hhmm).split(':');
  const h = Number(hStr), m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatSlot12(slot = '') {
  const [start, end] = String(slot).split('-');
  if (!end) return to12h(start || slot);
  return `${to12h(start)} - ${to12h(end)}`;
}

// auth
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

    profileForm.education    = p.education || ''
    profileForm.experience   = p.experience || ''
    profileForm.bio          = p.bio || ''
    profileForm.subjects     = p.subjects || []
    profileForm.languages    = p.languages || []
    profileForm.hourlyRate   = typeof p.hourlyRate === 'number' ? p.hourlyRate : 0
    profileForm.location     = p.location || ''
    profileForm.timezone     = p.timezone || ''
    profileForm.specialties  = Array.isArray(p.specialties) ? p.specialties : []
    profileForm.photoUrl     = p.photoUrl || (p.profilePicture && p.profilePicture.url) || (p.avatar && p.avatar.url) || ''

    profileSubjects.value    = profileForm.subjects.join(', ')
    profileLanguages.value   = profileForm.languages.join(', ')
    profileSpecialties.value = profileForm.specialties.join(', ')
  } catch (e) { alert(e.message) }
}
async function saveProfile() {
  try {
    profileForm.subjects    = profileSubjects.value.split(',').map(s => s.trim()).filter(Boolean)
    profileForm.languages   = profileLanguages.value.split(',').map(s => s.trim()).filter(Boolean)
    profileForm.specialties = profileSpecialties.value.split(',').map(s => s.trim()).filter(Boolean)

    const payload = {
      education: profileForm.education,
      experience: profileForm.experience,
      bio: profileForm.bio,
      subjects: profileForm.subjects,
      languages: profileForm.languages,
      hourlyRate: profileForm.hourlyRate,
      location: profileForm.location,
      timezone: profileForm.timezone,
      specialties: profileForm.specialties
    }
    const data = await api('/volunteers/me', { method: 'PUT', body: JSON.stringify(payload) })
    profileRaw.value = JSON.stringify(data, null, 2)
    alert('Profile saved')
  } catch (e) { alert(e.message) }
}
async function uploadProfilePhoto(evt) {
  const file = evt.target.files?.[0]
  if (!file) return
  try {
    const fd = new FormData()
    // IMPORTANT: backend expects 'avatar' on /me/avatar (and also on /me/photo alias)
    fd.append('avatar', file)
    const data = await api('/volunteers/me/avatar', { method: 'POST', body: fd })
    profileForm.photoUrl = data.photoUrl || ''
    await loadMyProfile()
  } catch (e) {
    alert(e.message)
  } finally {
    evt.target.value = ''
  }
}

// explore
const exploreSubject = ref('')
const exploreResults = ref([])
const exploreId = ref('')

// profile viewer state
const selectedProfile = ref(null)
const loadingProfile = ref(false)



// open profile (role should be 'volunteer' or 'student' or read from server)
// replace your existing openProfile with this
async function openProfile(userId, roleHint = '') {
  if (!userId) return alert('Missing user id');

  // try to find the user locally in exploreResults first
  const local = exploreResults.value.find(u => (u.userId || u._id) === userId);
  if (local) {
    // if local has full details already, use them; also clear reviews
    selectedProfile.value = local;
    currentProfileReviews.value = local.reviews || [];
    // optionally switch tab to 'explore' or keep current
    return;
  }

  loadingProfile.value = true;
  try {
    const tryVolunteer = async () => {
      const data = await api(`/volunteers/${userId}`, { method: 'GET' });
      // endpoint returns: { profile: {...}, reviews: [...] }
      const profile = data?.profile || data;
      currentProfileReviews.value = data?.reviews || [];
      return { profile, role: 'volunteer' };
    };

    const tryStudent = async () => {
      const data = await api(`/students/${userId}`, { method: 'GET' });
      // students endpoint returns profile directly with name/photo
      currentProfileReviews.value = []; // students have no reviews endpoint here
      return { profile: data, role: 'student' };
    };

    // pick based on hint; fallback try volunteer then student
    let res;
    if ((roleHint || '').toLowerCase().startsWith('vol')) {
      res = await tryVolunteer();
    } else if ((roleHint || '').toLowerCase().startsWith('stu')) {
      res = await tryStudent();
    } else {
      try {
        res = await tryVolunteer();
      } catch (e) {
        res = await tryStudent();
      }
    }

    // normalize a few fields for the UI
    const normalizeProfile = (profile, role) => ({
      userId: profile.userId || profile._id || userId,
      name: profile.name || profile.userName || '',
      role,
      photoUrl: profile.photoUrl || profile.avatar?.url || profile.profilePicture?.url || '',
      bio: profile.bio || profile.about || '',
      location: typeof profile.location === 'string' ? profile.location : (
        profile.location ? [profile.location.city, profile.location.state, profile.location.country].filter(Boolean).join(', ') : ''
      ),
      timezone: profile.timezone || '',
      subjects: Array.isArray(profile.subjects) ? profile.subjects : (profile.subjects ? String(profile.subjects).split(',').map(s => s.trim()) : []),
      interests: Array.isArray(profile.interests) ? profile.interests : (profile.interests ? String(profile.interests).split(',').map(s => s.trim()) : []),
      hourlyRate: profile.hourlyRate != null ? profile.hourlyRate : null,
      college: profile.college || (profile.education && profile.education[0] && profile.education[0].school) || '',
      // include everything for debug too
      __raw: profile
    });

    selectedProfile.value = normalizeProfile(res.profile || {}, res.role);
    // set tab optionally
    // tab.value = res.role === 'volunteer' ? 'volunteer' : 'student';

    // scroll to top so modal/view is visible
    window.scrollTo(0, 0);
  } catch (err) {
    console.error('openProfile failed', err);
    alert(err?.message || 'Failed to load profile');
  } finally {
    loadingProfile.value = false;
  }
}


// simple in-memory cache to avoid re-fetching on hover/click
const profileCache = ref(new Map())

async function preloadProfile(userId, roleHint = '') {
  if (!userId) return
  if (profileCache.value.has(userId)) return profileCache.value.get(userId)

  try {
    // try volunteer first if hint says volunteer, else student accordingly
    let data
    if ((roleHint || '').toLowerCase() === 'volunteer') {
      data = await api(`/volunteers/${userId}`, { method: 'GET' }).catch(() => null)
      if (data) { profileCache.value.set(userId, (data.profile || data)); return (data.profile || data) }
    } else if ((roleHint || '').toLowerCase() === 'student') {
      data = await api(`/students/${userId}`, { method: 'GET' }).catch(() => null)
      if (data) { profileCache.value.set(userId, data); return data }
    } else {
      // try volunteer then student
      data = await api(`/volunteers/${userId}`, { method: 'GET' }).catch(() => null)
      if (data) { profileCache.value.set(userId, (data.profile || data)); return (data.profile || data) }
      data = await api(`/students/${userId}`, { method: 'GET' }).catch(() => null)
      if (data) { profileCache.value.set(userId, data); return data }
    }
  } catch (e) {
    // ignore preload errors
    console.debug('preloadProfile failed', e?.message || e)
    return null
  }
}



function closeProfile() {
  selectedProfile.value = null
}

// filter by subject/interest
async function loadExplore() {
  try {
    let data
    if (isStudent.value) {
      const q = exploreSubject.value ? `?subject=${encodeURIComponent(exploreSubject.value)}` : ''
      data = await api(`/volunteers${q}`, { method: 'GET' })
    } else if (isVolunteer.value) {
      const q = exploreSubject.value ? `?interest=${encodeURIComponent(exploreSubject.value)}` : ''
      data = await api(`/students${q}`, { method: 'GET' })
    }
    exploreResults.value = Array.isArray(data) ? data : []
  } catch (e) {
    alert(e.message)
  }
}


// search by userId
async function loadExploreById() {
  try {
    if (!exploreId.value) return alert('Enter userId')

    let data
    if (isStudent.value) {
      data = await api(`/volunteers/${exploreId.value.trim()}`, { method: 'GET' })
    } else if (isVolunteer.value) {
      data = await api(`/students/${exploreId.value.trim()}`, { method: 'GET' })
    }

    exploreResults.value = data && !data.message ? [data] : []
  } catch (e) {
    alert(e.message)
  }
}



// Send session request from the volunteer quick send UI
async function sendSessionRequestToStudentFromInput() {
  if (!user.value) return alert('Login first');
  if (user.value.role !== 'volunteer' && user.value.role !== 'admin') return alert('Only volunteers/admin can send requests from here.');
  const studentId = (exploreStudentId.value || '').trim();
  if (!studentId) return alert('Enter a student userId');

  try {
    // prefer selected slot (from exploreStudentDate/exploreStudentTime), else send nulls
    const body = {
      target: studentId,
      subject: 'Offer to teach',
      message: exploreStudentMessage.value || 'Hi, I’d like to help you with this subject!',
      date: exploreStudentDate.value || null,
      time: exploreStudentTime.value || null
    };
    const data = await api('/sessions/request', { method: 'POST', body: JSON.stringify(body) });
    lastResponse.value = JSON.stringify(data, null, 2);
    alert('Session request sent!');
    // reset inputs
    exploreStudentId.value = '';
    exploreStudentMessage.value = '';
    exploreStudentDate.value = '';
    exploreStudentTime.value = '';
    exploreVolunteerAvail.value = [];
    exploreBookSlots.value = [];
    // refresh lists
    if (loadNotifications) await loadNotifications();
    if (loadMyRequests) await loadMyRequests();
  } catch (err) {
    console.error(err);
    alert(err?.message || 'Failed to send request');
  }
}

// load volunteer's own saved availability (calls /volunteers/:id/availability)
async function loadMyVolunteerAvailability() {
  if (!user.value) return alert('Login first');
  if (!user.value._id) return alert('Missing user id in local state');

  try {
    // use the same endpoint shape you used elsewhere
    const data = await api(`/volunteers/${user.value._id}/availability`, { method: 'GET' });
    exploreVolunteerAvail.value = Array.isArray(data) ? data : [];

    // auto-select first date and slots if present
    exploreStudentDate.value = exploreVolunteerAvail.value[0]?.date || '';
    exploreBookSlots.value = exploreVolunteerAvail.value[0]?.slots ? [...exploreVolunteerAvail.value[0].slots] : [];
    exploreStudentTime.value = exploreBookSlots.value[0] || '';
  } catch (e) {
    console.error('loadMyVolunteerAvailability failed', e);
    alert(e.message || 'Failed to load availability');
  }
}

// Used from student cards (keep or replace)
async function sendSessionRequestToStudent(studentId, message = null) {
  if (!user.value) return alert('Login first');
  try {
    const body = {
      target: studentId,
      subject: 'Offer to teach',
      message: message || 'Hi, I’d like to help you with this subject!',
      date: null,
      time: null
    };
    await api('/sessions/request', { method: 'POST', body: JSON.stringify(body) });
    alert('Session request sent!');
    if (loadNotifications) await loadNotifications();
    if (loadMyRequests) await loadMyRequests();
  } catch (e) {
    console.error(e);
    alert(e.message || 'Failed to send request');
  }
}


// session request
async function sendSessionRequest() {
  if (!user.value) return alert('Login first')
  if (user.value.role !== 'volunteer') return alert('Only volunteers can send requests')
  if (!manualTargetId.value) return alert('Enter target (student) userId')
  try {
    const body = { target: manualTargetId.value.trim(), subject: requestSubject.value || 'General', message: "I'd like to teach this topic", date: '2025-08-26', time: '11:00' }
    const data = await api('/sessions/request', { method: 'POST', body: JSON.stringify(body) })
    lastResponse.value = JSON.stringify(data, null, 2)
    alert('Request sent!')
  } catch (e) { alert(e.message) }
}

// Build LOCAL timestamp (ms) from separate strings (YYYY-MM-DD & HH:mm or HH:mm-HH:mm)
function buildMsFromDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  try {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const base = String(timeStr).split('-')[0].trim();
    const [hh, mm] = base.split(':').map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0, 0); // local
    const t = dt.getTime();
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

// my requests
async function loadMyRequests() {
  try {
    const data = await api('/sessions/mine', { method: 'GET' })
    if (!Array.isArray(data)) { myRequests.value = []; return }
    
    // compute startAt consistently
    const normalized = data.map(req => {
      // priority: scheduledAt -> final.date+time -> date+time -> startAt
      let iso = null
      if (req.scheduledAt) {
        const d = (typeof req.scheduledAt === 'number') ? new Date(req.scheduledAt) : new Date(req.scheduledAt)
        if (!Number.isNaN(d.getTime())) iso = d.toISOString()
      }
      if (!iso && req.final?.date && req.final?.time) {
        const ms = buildMsFromDateTime(req.final.date, req.final.time);
        if (ms !== null) iso = new Date(ms).toISOString();
      }
      if (!iso && req.date && req.time) {
        const ms = buildMsFromDateTime(req.date, req.time);
        if (ms !== null) iso = new Date(ms).toISOString();
      }
      if (!iso && req.startAt) {
        const d = (typeof req.startAt === 'number') ? new Date(req.startAt) : new Date(req.startAt);
        if (!Number.isNaN(d.getTime())) iso = d.toISOString();
      }
      const sortTime = iso ? new Date(iso).getTime() : Infinity
      return { ...req, startAt: iso, _sortDate: sortTime }
    })

    // ordering by status weight then by time
    const statusWeight = s => {
      if (s === 'pending') return 0
      if (s === 'scheduled') return 1
      if (s === 'accepted') return 2
      if (s === 'completed') return 3
      return 4
    }

    myRequests.value = normalized.sort((a, b) => {
      const wa = statusWeight(a.status), wb = statusWeight(b.status)
      if (wa !== wb) return wa - wb
      return (a._sortDate || 0) - (b._sortDate || 0)
    })
  } catch (e) {
    console.error('Failed to load requests:', e)
    alert(e.message || 'Failed to load session requests')
  }
}
async function acceptRequest(requestId) {
  try {
    if (!acceptDate.value || !acceptTime.value) {
      return alert('Please select both date and time for the session');
    }

    // Get the scheduled time in milliseconds (local time)
    const scheduledAtMs = buildMsFromDateTime(acceptDate.value, acceptTime.value);
    if (scheduledAtMs === null) {
      throw new Error('Invalid date or time selected');
    }
    
    // Call the accept endpoint with the scheduled time in milliseconds
    await api(`/sessions/${requestId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ 
        scheduledAt: scheduledAtMs,
        date: acceptDate.value,  // Include date and time separately as well
        time: acceptTime.value   // for backward compatibility
      })
    });

    // Refresh the UI
    await loadMyRequests();
    await loadNotifications();
    
    // Show the scheduled time in local format
    const scheduledDate = new Date(scheduledAtMs);
    alert(`Session accepted and scheduled for ${scheduledDate.toLocaleString()}`);
  } catch (e) {
    console.error('Error accepting request:', e);
    alert(e.message || 'Failed to accept session request');
  }
}

// notifications
async function loadNotifications() {
  try {
    const data = await api('/notifications', { method: 'GET' })
    notifications.value = Array.isArray(data) ? data : [];
    notifTotalUnread.value = (data || []).filter(n => !n.read).length;
  } catch (e) {
    console.error(e);
  }
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

// badges
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

// availability
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
  const data = await api(`/volunteers/${user.value._id}/availability?from=${availDate.value}&to=${availDate.value}`, { method: 'GET' })
  const day = Array.isArray(data) ? data.find(d => d.date === availDate.value) : null
  daySlots.value = day ? [...day.slots] : []
}
async function toggleSlot(s) {
  if (!user.value) return
  const action = daySlots.value.includes(s) ? 'remove' : 'add'
  await api('/volunteers/me/availability', { method: 'PATCH', body: JSON.stringify({ date: availDate.value, slot: s, action }) })
  await loadDayAvailability()
}
async function saveDayReplace() {
  await api('/volunteers/me/availability', { method: 'PUT', body: JSON.stringify({ date: availDate.value, slots: daySlots.value }) })
  alert('Availability saved')
}

// booking
const bookVolunteerId = ref('')
const bookDate = ref('')
const bookSlots = ref([])
const volunteerAvail = ref([])
const selectedSlot = ref('')
const bookingMessage = ref('')
const requestMessage = ref('')

async function loadVolunteerAvailability() {
  if (!bookVolunteerId.value) return alert('Enter volunteer userId')
  const data = await api(`/volunteers/${bookVolunteerId.value.trim()}/availability`, { method: 'GET' })
  volunteerAvail.value = Array.isArray(data) ? data : []
  bookDate.value = volunteerAvail.value[0]?.date || ''
  bookSlots.value = volunteerAvail.value.find(d => d.date === bookDate.value)?.slots || []
}
function onPickBookDate(d) {
  bookDate.value = d
  bookSlots.value = volunteerAvail.value.find(x => x.date === d)?.slots || []
}

// Replace your old bookSlotAsStudent function with this:
// ...existing code...

async function bookSlotAsStudent() {
  if (!user.value) return alert('Login first')
  if (user.value.role !== 'student' && user.value.role !== 'admin') 
    return alert('Only student/admin can book')
  if (!bookVolunteerId.value || !bookDate.value || !selectedSlot.value) 
    return alert('Pick volunteer, date, and slot')

  try {
    const body = { 
      target: bookVolunteerId.value.trim(),   // backend expects "target"
      subject: 'Selected Slot', 
      message: bookingMessage.value || 'Booking via availability', // custom message
      date: bookDate.value, 
      time: selectedSlot.value                 // ✅ use selectedSlot.value
    }

    const data = await api('/sessions/request', { 
      method: 'POST', 
      body: JSON.stringify(body) 
    })

    lastResponse.value = JSON.stringify(data, null, 2)
    alert('Request sent! Volunteer will be notified.')

    // reset after success
    selectedSlot.value = ''
    bookingMessage.value = ''
  } catch (err) {
    alert(err.message || 'Failed to send request')
  }
}


// Join a session: prefer showing the Call UI with "Join (external)" button
async function joinSession(sessionId) {
  if (!user.value) return alert('Login first')
  if (!sessionId) return alert('Missing session id')

  try {
    // Load/refresh the session object first so we can show the UI correctly
    // If you have /sessions/:id -> use it; otherwise fall back to /sessions/mine and find it.
    let s = null
    try {
      s = await api(`/sessions/${sessionId}` , { method: 'GET' })
    } catch {
      const mine = await api('/sessions/mine', { method: 'GET' })
      s = (Array.isArray(mine) ? mine : []).find(x => String(x._id) === String(sessionId)) || null
    }

    if (!s) {
      // still show UI and try generating link on demand
      callRoomSession.value = { _id: sessionId }
      showCallRoom.value = true
    } else {
      callRoomSession.value = s
      showCallRoom.value = true
    }

    // if there is already a Zoom link, the CallRoom will show a "Join (external)" button.
    // If not, you can still click "Generate & Join" inside CallRoom (it will call POST /api/sessions/:id/join)

  } catch (err) {
    console.error('joinSession failed', err)
    alert(err?.message || 'Failed to start/join session')
  }
}

// people
function buildFollowingSet() { followingSet.value = new Set((following.value || []).map(p => String(p._id))) }
function isFollowingId(id) { return followingSet.value.has(String(id)) }
async function loadNetwork() {
  if (!user.value) return
  const data = await api('/users/me/network', { method: 'GET' })
  followers.value = data.followers || []
  following.value = data.following || []
  buildFollowingSet()
}
function loadNetworkIfAuthed() { if (user.value) loadNetwork() }
async function followUser(targetId) {
  if (!user.value) return alert('Login first')
  if (String(user.value._id) === String(targetId)) return alert("You can't follow yourself")
  await api(`/users/${targetId}/follow`, { method: 'POST' })
  await loadNetwork()
}
async function followById() { const id = (followTargetId.value || '').trim(); if (!id) return alert('Enter userId'); await followUser(id) }
async function unfollowById(targetId) {
  if (!user.value) return alert('Login first')
  if (String(user.value._id) === String(targetId)) return alert("You can't unfollow yourself")
  await api(`/users/${targetId}/follow`, { method: 'DELETE' })
  await loadNetwork()
}

// stats
async function loadDashboard() {
  const id = (statsVolunteerId.value || (user.value && user.value._id) || '').trim()
  if (!id) return alert('Enter a volunteer userId or login to use your own')
  const data = await api(`/users/${id}/dashboard`, { method: 'GET' })
  if (data?.message) { alert(data.message); return }
  dashboard.value = data
}

// ======== CHAT LOGIC ========
const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000';

function connectSocket() {
  // Don't reconnect if already connected
  if (socket.value?.connected) {
    console.log('WebSocket already connected, skipping...');
    return;
  }

  // Clean up existing socket if any
  if (socket.value) {
    socket.value.off();
    socket.value.disconnect();
    socket.value = null;
  }

  // Get fresh token from localStorage
  const storedToken = localStorage.getItem('token');
  if (!storedToken) {
    console.warn('No auth token found for WebSocket');
    return;
  }

  console.log('Connecting to WebSocket...');

  socket.value = io(WS_URL, {
    transports: ['websocket', 'polling'],
    auth: { token: storedToken },
    autoConnect: true,
    forceNew: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 15000
  });

  // --- connection lifecycle ---
  socket.value.on('connect', () => {
    console.log('✅ WebSocket connected with ID:', socket.value.id);
    socket.value.emit('authenticate', { token: storedToken });
  });

  socket.value.on('disconnect', (reason) => {
    console.warn('❌ WebSocket disconnected:', reason);
    if (reason === 'io server disconnect') {
      setTimeout(() => socket.value.connect(), 1000);
    }
  });

  socket.value.on('reconnect_attempt', (attempt) => {
    console.log(`🔁 Reconnection attempt ${attempt}/5`);
  });
  
  socket.value.on('reconnect_failed', () => console.error('❌ WebSocket reconnection failed'));
  
  socket.value.on('connect_error', (error) => console.error('WebSocket connection error:', error?.message || error));
  
  socket.value.on('auth_error', (error) => {
    console.error('WebSocket authentication failed:', error?.message || error);
    // prefer logout flow instead of forcing pathname change
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    token.value = '';
    user.value = null;
    // optionally: switch to auth tab
    tab.value = 'auth';
  });

  // --- session events ---
  socket.value.on('session:update', (updatedSession) => {
    console.log('📝 Session updated:', updatedSession?._id);
    updateSessionInList(updatedSession);
    if (user.value &&
        (updatedSession.student?._id === user.value._id ||
         updatedSession.volunteer?._id === user.value._id ||
         updatedSession.requestedBy?._id === user.value._id)) {
      loadNotifications();
    }
  });

  // --- custom: session expired ---
  socket.value.on('session:expired', ({ _id }) => {
    if (!_id) return;
    const idx = myRequests.value.findIndex(r => String(r._id) === String(_id));
    if (idx !== -1) {
      myRequests.value[idx] = { ...myRequests.value[idx], status: 'expired' };
    }
  });

  // --- custom: session presence ---
  socket.value.on('session:presence', (payload) => {
    if (!payload?._id) return;
    const idx = myRequests.value.findIndex(r => String(r._id) === String(payload._id));
    if (idx !== -1) {
      myRequests.value[idx] = { ...myRequests.value[idx], ...('attendance' in payload ? { attendance: payload.attendance } : {}), ...('status' in payload ? { status: payload.status } : {}) };
    }
  });

  socket.value.on('session:cancelled', ({ _id }) => {
    myRequests.value = myRequests.value.filter(r => String(r._id) !== String(_id));
    try { loadNotifications(); } catch {}
  });

  socket.value.on('notification:new', (notification) => {
    console.log('🔔 New notification:', notification?.type);
    loadNotifications();
  });

  socket.value.on('session:request', (session) => {
    console.log('📨 New session request:', session?._id);
    loadMyRequests();
    loadNotifications();
  });

  socket.value.on('session:accepted', async (payload) => {
    try {
      console.debug('socket session:accepted', payload);
      const sessionObj = payload?.session || payload;
      const id = String(sessionObj._id || sessionObj.requestId || payload?._id);
      if (!id) { await loadMyRequests(); return; }
      const idx = myRequests.value.findIndex(r => String(r._id) === id);
      if (idx !== -1) {
        myRequests.value[idx] = { ...myRequests.value[idx], ...sessionObj, status: 'accepted' };
      } else {
        await loadMyRequests();
      }
      loadNotifications();
    } catch (e) { console.error('Error handling session:accepted event:', e); }
  });

  socket.value.on('session:rejected', async (payload) => {
    try {
      console.debug('socket session:rejected', payload);
      const sessionObj = payload?.session || payload;
      const id = String(sessionObj._id || sessionObj.requestId || payload?._id);
      if (!id) { await loadMyRequests(); return; }
      const idx = myRequests.value.findIndex(r => String(r._id) === id);
      if (idx !== -1) {
        myRequests.value[idx] = { ...myRequests.value[idx], ...sessionObj, status: 'rejected' };
      } else {
        await loadMyRequests();
      }
      loadNotifications();
    } catch (e) { console.error('Error handling session:rejected event:', e); }
  });

  socket.value.on('session:scheduled', async (payload) => {
    try {
      console.debug('socket session:scheduled', payload);
      if (payload?.session?._id) updateSessionInList(payload.session);
      else await loadMyRequests();
      if (user.value) {
        const isParticipant = String(user.value._id) === String(payload?.studentId) || String(user.value._id) === String(payload?.volunteerId);
        if (isParticipant) {
          const sessionTime = new Date(payload?.startAt || payload?.scheduledAt || Date.now());
          alert(`✅ session scheduled for ${sessionTime.toLocaleString()}`);
        }
      }
    } catch (e) { console.error('session:scheduled handler failed', e); await loadMyRequests(); }
  });

  socket.value.on('session:starting', (session) => {
    try {
      if (!user.value) return;
      const isParticipant = String(user.value._id) === String(session?.student || session?.studentId) ||
                          String(user.value._id) === String(session?.volunteer || session?.volunteerId);
      if (!isParticipant) return;

      // prefer common locations for join URL
      const joinLink =
        session?.final?.zoomLink ||
        session?.zoomLink ||
        session?.joinUrl ||
        session?.joinLink ||
        session?.raw?.final?.zoomLink ||
        null;

      const subject = session?.subject || '';
      const startTime = session?.startAt ? new Date(session.startAt).toLocaleTimeString() : (session?.startAt ? new Date(session.startAt).toLocaleString() : 'now');

      if (confirm(`Your ${subject ? subject + ' ' : ''}session is starting at ${startTime}.\n\nClick OK to join now.` )) {
        if (joinLink) window.open(joinLink, '_blank');
        else {
          // try to ask server to generate link on-demand
          joinSession(String(session.sessionId || session._id || session.requestId || session.sessionId));
        }
      }
    } catch (e) { console.error('Error in session:starting handler:', e); }
  });

  // --- chat events (message etc) ---
  socket.value.on('message:new', async ({ conversationId, message } = {}) => {
    // optional: if activeConv matches, push message; else mark conversation updated
    if (activeConv.value && String(activeConv.value._id) === String(conversationId)) {
      messages.value.push(message);
      await nextTick(); 
      scrollToBottom();
    } else {
      await loadConversations();
    }
  });

  socket.value.on('conversations:updated', async () => { 
    await loadConversations(); 
  });
  
  socket.value.on('conversation:typing', ({ conversationId, userId, isTyping } = {}) => { 
    // Handle typing indicator if needed
    console.log(`User ${userId} is ${isTyping ? 'typing' : 'not typing'} in conversation ${conversationId}`);
  });
}

async function loadConversations() {
  if (!user.value) return
  conversations.value = await api('/chat/conversations', { method: 'GET' })
}

function displayPeer(conv) {
  if (!user.value) return ''
  const arr = conv.participants || []
  const other = arr.find(p => String(p._id || p) !== String(user.value._id))
  if (!other) return ''
  if (typeof other === 'string') return other
  return other.name || (other._id || '')
}
function displayPeerRole(conv) {
  if (!user.value) return ''
  const arr = conv.participants || []
  const other = arr.find(p => String(p._id || p) !== String(user.value._id))
  if (!other || typeof other === 'string') return ''
  return other.role || ''
}

async function openConversation(c) {
  activeConv.value = c
  messages.value = await api(`/chat/${c._id}/messages`, { method: 'GET' })
  socket.value?.emit("conversation:join", c._id)
  await nextTick()
  scrollToBottom()
  await markConversationRead(c._id)
  c.unread = 0
}

async function markConversationRead(conversationId) {
  await api(`/chat/${conversationId}/read`, { method: 'POST' })
  socket.value?.emit("conversation:read", { conversationId })
}

// start chat (always 1:1 DM)
async function startChatWith(targetUserId) {
  if (!user.value) return alert('Login first')
  const conv = await api('/chat/conversations/open', {
    method: 'POST',
    body: JSON.stringify({ userId: targetUserId }) // <- single DM
  })
  await loadConversations()
  const found = conversations.value.find(x => String(x._id) === String(conv._id)) || conv
  tab.value = 'chats'
  await openConversation(found)
}

// open chat from session -> also route to the SAME 1:1 DM
async function openChatForSession(req) {
  const candidate = (String(req.volunteer) === String(user.value._id)) ? (req.student) : (req.volunteer);
  const otherId = candidate && (candidate._id || candidate) ? String(candidate._id || candidate) : null;
  if (!otherId) return alert('Cannot open chat: other participant id missing on session');
  
  const conv = await api('/chat/conversations/open', {
    method: 'POST',
    body: JSON.stringify({ userId: otherId }) // <- IMPORTANT: no sessionRequestId
  })
  await loadConversations()
  const found = conversations.value.find(x => String(x._id) === String(conv._id)) || conv
  tab.value = 'chats'
  await openConversation(found)
}

// ======== ATTACHMENTS ========
async function onPickFiles(evt) {
  const files = evt.target.files
  if (!files || files.length === 0) return

  try {
    isUploading.value = true
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('files', f))
    const data = await api('/chat/upload', { method: 'POST', body: fd })
    pendingUploads.value = [...pendingUploads.value, ...data]
    evt.target.value = '' // reset picker
  } catch (e) { alert(e.message) }
  finally { isUploading.value = false }
}
function clearPendingUploads() { pendingUploads.value = [] }
async function sendMessage() {
  if (!activeConv.value) return
  const payload = { conversationId: activeConv.value._id, text: (draft.value || '').trim(), attachments: pendingUploads.value }
  if (!payload.text && (!payload.attachments || !payload.attachments.length)) return
  socket.value?.emit("message:send", payload)
  draft.value = ''
  clearPendingUploads()
}
function scrollToBottom() {
  const el = scrollBox.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

// Cancel a session
async function cancelSession(sessionOrId) {
  try {
    const id = typeof sessionOrId === 'string' ? sessionOrId : (sessionOrId && (sessionOrId._id || sessionOrId.id));
    if (!id) return alert("Missing request id");
    
    // Double confirm (optional but recommended)
    const ok = confirm("This will cancel the session for both participants. Continue?");
    if (!ok) return;

    await api(`/sessions/${id}/cancel`, { 
      method: 'POST', 
      body: JSON.stringify({}) 
    });

    // Remove from the list immediately
    myRequests.value = myRequests.value.filter(r => String(r._id) !== String(id));

    // Refresh notifications (optional)
    try { 
      await loadNotifications(); 
    } catch (e) {
      console.warn("Failed to refresh notifications:", e);
    }
  } catch (e) {
    console.error("cancelRequest error", e);
    alert(e?.response?.data?.message || e?.message || "Failed to cancel session");
  }
}

// keep myRequests in sync when sockets send session updates
function updateSessionInList(updated) {
  if (!updated || !updated._id) return;
  const id = String(updated._id);
  const idx = myRequests.value.findIndex(r => String(r._id) === id);
  
  // compute startAt as ms (local time) for the updated item
  const computeMsFor = (req) => {
    if (req.scheduledAt) {
      const t = new Date(req.scheduledAt).getTime();
      if (!Number.isNaN(t)) return t;
    }
    if (req.final?.date && req.final?.time) {
      return buildMsFromDateTime(req.final.date, req.final.time);
    }
    if (req.date && req.time) {
      return buildMsFromDateTime(req.date, req.time);
    }
    if (req.startAt) {
      const t = new Date(req.startAt).getTime();
      if (!Number.isNaN(t)) return t;
    }
    return null;
  };

  const ms = computeMsFor(updated);
  const normalized = { ...updated, startAt: ms, _sortDate: ms ?? Infinity };

  if (idx !== -1) {
    // replace in-place
    myRequests.value[idx] = { ...myRequests.value[idx], ...normalized }
  } else {
    // new: add to top
    myRequests.value.unshift(normalized)
  }

  // re-sort according to same rules used in loadMyRequests
  const statusWeight = s => {
    if (s === 'pending') return 0
    if (s === 'scheduled') return 1
    if (s === 'accepted') return 2
    if (s === 'completed') return 3
    return 4
  }
  myRequests.value.sort((a, b) => {
    const wa = statusWeight(a.status), wb = statusWeight(b.status)
    if (wa !== wb) return wa - wb
    return (a._sortDate || 0) - (b._sortDate || 0)
  })
}

// Start a video call with a user (ad-hoc or session-based)
function startVideoCall(targetUserId) {
  if (!user.value || !targetUserId) return;

  // Close the profile modal if open
  closeProfile();

  // Ad-hoc call (no session yet) — you'll use in-app WebRTC room as a fallback
  // If you want this to always be Zoom, create a session on the server here first, then set callRoomSession to that session.
  callRoomSession.value = {
    _id: null,
    peerId: targetUserId,
    // no externalJoinLink -> CallRoom will try in-app WebRTC only
  };
  showCallRoom.value = true;
}

// Handle leaving a video call
function handleLeaveCall() {
  showCallRoom.value = false;
  callRoomSession.value = null;
  console.log('Left video call');
}

// student progress
async function loadMyProgress() {
  try {
    const data = await api('/users/me/progress', { method: 'GET' });
    progress.value = data || {};
  } catch (e) {
    console.error('loadMyProgress failed', e);
    alert(e.message || 'Failed to load progress');
  }
}

// lifecycle
const _storageHandler = (e) => {
  if (e.key === 'token') {
    const newToken = e.newValue || '';
    // Only update if token actually changed
    if (newToken !== token.value) {
      token.value = newToken;
      if (!newToken) {
        user.value = null;
        if (socket.value) {
          socket.value.disconnect();
          socket.value = null;
        }
      } else if (!socket.value?.connected) {
        connectSocket();
      }
    }
  } else if (e.key === 'user') {
    try { 
      const newUser = JSON.parse(e.newValue || 'null');
      // Only update if user actually changed
      if (JSON.stringify(newUser) !== JSON.stringify(user.value)) {
        user.value = newUser;
      }
    } catch { 
      user.value = null; 
    }
  }
};

onMounted(() => {
  if (user.value && token.value) {
    connectSocket();
    switchTab('explore');
    if (user.value.role === 'student') loadMyProgress();
  }
  window.addEventListener('storage', _storageHandler);
});

onBeforeUnmount(() => {
  if (socket.value) socket.value.disconnect();
  window.removeEventListener('storage', _storageHandler);
})
</script>

<style>
/* Small visual tweaks for clearer chat */
.card.soft { background: #f8fafc; }
.card.tiny { padding: 6px 8px; border-radius: 8px; }
.stat { font-size: 24px; font-weight: 700; }

/* Optional: ensure inputs don't shrink in flex rows */
input[type="text"], input[type="number"], input[type="password"], textarea, select {
  min-width: 0;
}

/* clickable name + card hover */
.clickable { 
  cursor: pointer; 
  text-decoration: none; 
  color: inherit; 
}
.clickable:hover { 
  text-decoration: underline; 
  color: #60a5fa; 
}

/* small effect when hovering cards */
.card:hover { 
  transform: translateY(-2px); 
  transition: transform .12s ease; 
}

/* profile modal */
.profile-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display:flex;
  align-items:center;
  justify-content:center;
  z-index: 1200;
  padding: 18px;
}

.profile-modal {
  width: min(1000px, 96%);
  max-height: 88vh;
  overflow: auto;
  background: var(--card-bg, #0b1220);
  border-radius: 10px;
  padding: 14px;
  box-shadow: 0 10px 30px rgba(2,6,23,0.6);
}

.profile-modal .badge {
  font-size: 0.8em;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #1a202c;
}

.profile-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 20px;
}

.profile-modal {
  max-width: 800px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  background: white;
  border-radius: 8px;
  padding: 20px;
}

.profile-section, .reviews-section {
  margin-bottom: 24px;
}

.info-section {
  margin: 16px 0;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.tag {
  background: #e2e8f0;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 0.875rem;
}

.review-card {
  background: #f8fafc;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}

.review-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.reviewer {
  font-weight: 600;
}

.rating {
  color: #f59e0b;
}

.review-content {
  margin: 8px 0;
  color: #334155;
}

.review-date {
  font-size: 0.875rem;
  color: #64748b;
}

.debug-info {
  background: #f1f5f9;
  padding: 16px;
  border-radius: 8px;
  margin-top: 16px;
}

.debug-info pre {
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
}

</style>
