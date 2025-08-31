// src/main.js
import { createApp } from 'vue'
// import App from './App.vue'          // Volunteer testing UI
import StudentTest from './StudentTest.vue' // Student testing UI
import './style.css'

// To switch between UIs:
// 👉 For Volunteer: uncomment App + comment StudentTest
// 👉 For Student:   uncomment StudentTest + comment App

// createApp(App).mount('#app')    // Volunteer
createApp(StudentTest).mount('#app') // Student
