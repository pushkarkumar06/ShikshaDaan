<template>
  <div class="app">
    <h1>ShikshaDaan – Student Test UI (Vue)</h1>
    <p class="subtitle">Quick test UI for student features. Real UI will come later 🚀</p>

    <!-- Navbar -->
    <nav class="navbar">
      <button v-for="tab in tabs" :key="tab" @click="currentTab = tab" :class="{ active: currentTab === tab }">
        {{ tab }}
      </button>
      <button v-if="token" class="logout" @click="logout">Logout</button>
    </nav>

    <!-- Auth -->
    <section v-if="currentTab === 'Auth'" class="card">
      <h2>Auth</h2>
      <form @submit.prevent="signup">
        <h3>Signup</h3>
        <input v-model="signupData.name" placeholder="Name" />
        <input v-model="signupData.email" placeholder="Email" />
        <input v-model="signupData.password" type="password" placeholder="Password" />
        <button type="submit">Signup</button>
      </form>

      <form @submit.prevent="login">
        <h3>Login</h3>
        <input v-model="loginData.email" placeholder="Email" />
        <input v-model="loginData.password" type="password" placeholder="Password" />
        <button type="submit">Login</button>
      </form>
      <p v-if="token">✅ Logged in as {{ user?.name }} ({{ user?.role }})</p>
    </section>

    <!-- Profile -->
    <section v-if="currentTab === 'Profile' && token" class="card">
      <h2>Student Profile</h2>
      <form @submit.prevent="updateProfile">
        <input v-model="profile.college" placeholder="College" />
        <input v-model="profile.course" placeholder="Course" />
        <input v-model="profile.year" placeholder="Year" />
        <input v-model="profile.academicLevel" placeholder="Academic Level" />
        <input v-model="profile.bio" placeholder="Bio" />
        <input v-model="profile.interests" placeholder="Interests (comma separated)" />
        <input v-model="profile.skillsToLearn" placeholder="Skills To Learn (comma separated)" />
        <input v-model="profile.languages" placeholder="Languages (comma separated)" />
        <button type="submit">Save Profile</button>
      </form>

      <!-- Profile Picture Upload -->
      <h3>Profile Picture</h3>
      <input type="file" @change="onFileChange" />
      <button @click="uploadPhoto" :disabled="!selectedFile">Upload</button>
      <div v-if="studentProfile?.profilePicture?.url">
        <p>📸 Current:</p>
        <img :src="studentProfile.profilePicture.url" style="max-width:120px;border-radius:8px;" />
      </div>

      <pre>{{ studentProfile }}</pre>
    </section>

    <!-- Explore Volunteers -->
    <section v-if="currentTab === 'Explore' && token" class="card">
      <h2>Explore Volunteers</h2>
      <input v-model="searchSubject" placeholder="Filter by subject" />
      <button @click="fetchVolunteers">Search</button>

      <div v-for="vol in volunteers" :key="vol._id" class="vol-card">
        <h3>{{ vol.user?.name || 'Volunteer' }}</h3>
        <p><b>Subjects:</b> {{ vol.subjects?.join(", ") }}</p>
        <p><b>Bio:</b> {{ vol.bio }}</p>
        <button @click="followVolunteer(vol.userId)">Follow</button>
        <button @click="messageVolunteer(vol.userId)">Message</button>
      </div>
    </section>

    <!-- Book Session -->
    <section v-if="currentTab === 'Book' && token" class="card">
      <h2>Book Session</h2>
      <form @submit.prevent="bookSession">
        <input v-model="session.volunteerId" placeholder="Volunteer UserId" />
        <input v-model="session.subject" placeholder="Subject" />
        <input v-model="session.message" placeholder="Message (optional)" />
        <input v-model="session.date" placeholder="Date (YYYY-MM-DD)" />
        <input v-model="session.slot" placeholder="Slot (e.g. 14:00-15:00)" />
        <button type="submit">Book</button>
      </form>
      <pre>{{ sessionResponse }}</pre>
    </section>

    <!-- My Requests -->
    <section v-if="currentTab === 'Requests' && token" class="card">
      <h2>My Requests</h2>
      <button @click="fetchMySessions">Load</button>
      <div v-for="req in mySessions" :key="req._id" class="req-card">
        <p><b>Volunteer:</b> {{ req.volunteer?.name }}</p>
        <p><b>Subject:</b> {{ req.subject }}</p>
        <p><b>Status:</b> {{ req.status }}</p>
      </div>
    </section>

    <!-- Notifications -->
    <section v-if="currentTab === 'Notifications' && token" class="card">
      <h2>Notifications</h2>
      <button @click="fetchNotifications">Load</button>
      <div v-for="n in notifications" :key="n._id" class="noti-card">
        <p><b>Type:</b> {{ n.type }}</p>
        <p><b>Data:</b> {{ n.payload }}</p>
      </div>
    </section>
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "StudentTest",
  data() {
    return {
      api: "http://localhost:5000/api",
      token: null,
      user: null,

      tabs: ["Auth", "Profile", "Explore", "Book", "Requests", "Notifications"],
      currentTab: "Auth",

      // Auth
      signupData: { name: "", email: "", password: "" },
      loginData: { email: "", password: "" },

      // Profile
      profile: {
        college: "",
        course: "",
        year: "",
        academicLevel: "",
        bio: "",
        interests: "",
        skillsToLearn: "",
        languages: ""
      },
      studentProfile: null,
      selectedFile: null,

      // Volunteers
      searchSubject: "",
      volunteers: [],

      // Sessions
      session: { volunteerId: "", subject: "", message: "", date: "", slot: "" },
      sessionResponse: null,
      mySessions: [],

      // Notifications
      notifications: [],
    };
  },
  methods: {
    async signup() {
      try {
        await axios.post(`${this.api}/auth/signup`, { ...this.signupData, role: "student" });
        alert("Signup successful, now login!");
      } catch (err) {
        alert("Signup failed");
        console.error(err);
      }
    },
    async login() {
      try {
        const res = await axios.post(`${this.api}/auth/login`, this.loginData);
        this.token = res.data.token;
        this.user = res.data.user;
        axios.defaults.headers.common["Authorization"] = `Bearer ${this.token}`;
        alert("Login success");

        // ✅ fetch student profile immediately after login
        await this.loadProfile();
      } catch (err) {
        alert("Login failed");
        console.error(err);
      }
    },
    async loadProfile() {
      try {
        const res = await axios.get(`${this.api}/students/${this.user._id}`);
        this.studentProfile = res.data;

        // pre-fill the form fields
        Object.assign(this.profile, {
          college: res.data.college || "",
          course: res.data.course || "",
          year: res.data.year || "",
          academicLevel: res.data.academicLevel || "",
          bio: res.data.bio || "",
          interests: res.data.interests?.join(", ") || "",
          skillsToLearn: res.data.skillsToLearn?.join(", ") || "",
          languages: res.data.languages?.join(", ") || "",
        });
      } catch (err) {
        console.error("Failed to load profile", err);
      }
    },
    async updateProfile() {
      try {
        const payload = {
          ...this.profile,
          interests: this.profile.interests.split(",").map((s) => s.trim()),
          skillsToLearn: this.profile.skillsToLearn.split(",").map((s) => s.trim()),
          languages: this.profile.languages.split(",").map((s) => s.trim()),
        };
        const res = await axios.put(`${this.api}/students/me`, payload);
        this.studentProfile = res.data;
        alert("Profile updated!");
      } catch (err) {
        console.error(err);
        alert("Profile update failed");
      }
    },
    onFileChange(e) {
      this.selectedFile = e.target.files[0];
    },
    async uploadPhoto() {
      if (!this.selectedFile) return alert("Select file first");
      try {
        const formData = new FormData();
        formData.append("photo", this.selectedFile);
        const res = await axios.post(`${this.api}/students/me/photo`, formData, { headers: { "Content-Type": "multipart/form-data" } });
        this.studentProfile = res.data;
        this.selectedFile = null;
        alert("Photo uploaded!");
      } catch (err) {
        console.error(err);
        alert("Upload failed");
      }
    },
    async fetchVolunteers() {
      try {
        const res = await axios.get(`${this.api}/volunteers`, { params: { subject: this.searchSubject } });
        this.volunteers = res.data;
      } catch (err) {
        console.error(err);
        alert("Failed to fetch volunteers");
      }
    },
    followVolunteer(id) {
      alert(`Follow volunteer ${id} (backend to be connected)`);
    },
    messageVolunteer(id) {
      alert(`Message volunteer ${id} (chat UI later)`);
    },
    async bookSession() {
      try {
        const res = await axios.post(`${this.api}/sessions/request`, this.session);
        this.sessionResponse = res.data;
      } catch (err) {
        console.error(err);
        alert("Booking failed");
      }
    },
    async fetchMySessions() {
      try {
        const res = await axios.get(`${this.api}/sessions/mine`);
        this.mySessions = res.data;
      } catch (err) {
        console.error(err);
        alert("Failed to fetch sessions");
      }
    },
    async fetchNotifications() {
      try {
        const res = await axios.get(`${this.api}/notifications`);
        this.notifications = res.data;
      } catch (err) {
        console.error(err);
        alert("Failed to fetch notifications");
      }
    },
    logout() {
      this.token = null;
      this.user = null;
      axios.defaults.headers.common["Authorization"] = "";
      this.currentTab = "Auth";
      alert("Logged out");
    },
  },
};
</script>

<style>
body {
  background: #111;
  color: #fff;
  font-family: Arial, sans-serif;
}
.app {
  padding: 20px;
  max-width: 800px;
  margin: auto;
}
.subtitle {
  color: #bbb;
}
.navbar {
  margin: 20px 0;
}
.navbar button {
  margin-right: 8px;
  padding: 8px 14px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: #333;
  color: #fff;
}
.navbar button.active {
  background: #2563eb;
}
.navbar .logout {
  background: #e74c3c;
  float: right;
}
.card {
  background: #1e1e1e;
  padding: 20px;
  border-radius: 10px;
  margin-bottom: 20px;
}
input {
  display: block;
  margin: 6px 0;
  padding: 8px;
  width: 100%;
  border-radius: 6px;
  border: 1px solid #444;
  background: #222;
  color: #fff;
}
button {
  margin: 8px 0;
  padding: 10px;
  background: #2563eb;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: #fff;
}
.vol-card,
.req-card,
.noti-card {
  background: #2a2a2a;
  padding: 12px;
  border-radius: 8px;
  margin: 10px 0;
}
</style>
