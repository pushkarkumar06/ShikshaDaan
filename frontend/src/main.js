// src/main.js
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

/**
 * Entry point for the demo app.
 * - Exposes API base and WS URL as global properties so components can reuse them.
 * - Enables Vue devtools in development.
 */

const app = createApp(App);

// provide global config (can be read in components via getCurrentInstance().appContext.config.globalProperties)
app.config.globalProperties.$API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";
app.config.globalProperties.$WS_URL = import.meta.env.VITE_WS_URL || "http://localhost:5000";

// optional: expose a simple logger
app.config.globalProperties.$log = (...args) => console.log("[App]", ...args);

// enable devtools in development builds
if (import.meta.env.DEV) {
  app.config.devtools = true;
}

app.mount("#app");
