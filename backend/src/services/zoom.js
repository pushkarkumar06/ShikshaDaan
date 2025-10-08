// src/services/zoom.js
// ES module version (matches your current import style)

import crypto from "crypto";

/**
 * This file implements Zoom Server-to-Server OAuth and Meetings API helpers.
 * ENV required:
 *  - ZOOM_ACCOUNT_ID
 *  - ZOOM_CLIENT_ID
 *  - ZOOM_CLIENT_SECRET
 *  - ZOOM_DEFAULT_HOST_EMAIL
 *
 * Optional:
 *  - ZOOM_WEBHOOK_SECRET_TOKEN (used in your webhook route, not here)
 */

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";

let _cachedToken = null;
let _cachedExp = 0; // epoch seconds

/** Fetch (and cache) an S2S OAuth access token */
export async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && now < _cachedExp - 60) return _cachedToken;

  const params = new URLSearchParams({
    grant_type: "account_credentials",
    account_id: process.env.ZOOM_ACCOUNT_ID,
  });

  const basic = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${ZOOM_TOKEN_URL}?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(
      `Zoom token error ${res.status}: ${JSON.stringify(body) || res.statusText}`
    );
  }

  const data = await res.json(); // { access_token, token_type, expires_in }
  _cachedToken = data.access_token;
  _cachedExp = Math.floor(Date.now() / 1000) + (data.expires_in || 0);
  return _cachedToken;
}

/**
 * Create a scheduled Zoom meeting.
 * @param {Object} opts
 * @param {string} opts.hostEmail - Zoom user email that will own the meeting
 * @param {string} opts.topic
 * @param {string} opts.start_time - ISO8601 UTC string (e.g., "2025-10-09T11:30:00Z")
 * @param {number} opts.duration - minutes
 * @param {string} [opts.agenda]
 * @returns {Promise<{meetingId:string,startUrl:string,joinUrl:string,password?:string,raw:any}>}
 */
export async function createMeeting({
  hostEmail = process.env.ZOOM_DEFAULT_HOST_EMAIL,
  topic,
  start_time,
  duration,
  agenda,
}) {
  if (!hostEmail) throw new Error("hostEmail missing");
  if (!topic) topic = "ShikshaDaan Session";
  if (!start_time) throw new Error("start_time (ISO) missing");
  if (!duration) duration = 30;

  const token = await getAccessToken();
  const url = `${ZOOM_API_BASE}/users/${encodeURIComponent(hostEmail)}/meetings`;

  const payload = {
    topic,
    type: 2, // scheduled
    start_time, // must be ISO8601 UTC string
    duration, // minutes
    agenda,
    settings: {
      join_before_host: false,
      waiting_room: true,
      mute_upon_entry: true,
      participant_video: true,
      host_video: true,
      approval_type: 2, // no registration approval
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(
      `Zoom createMeeting error ${res.status}: ${JSON.stringify(body) || res.statusText}`
    );
  }

  const z = await res.json();
  return {
    meetingId: String(z.id),
    startUrl: z.start_url,
    joinUrl: z.join_url,
    password: z.password,
    raw: z,
  };
}

/**
 * End a Zoom meeting (used by auto-end or manual end).
 * @param {string|number} meetingId
 */
export async function endMeeting(meetingId) {
  const token = await getAccessToken();
  const res = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}/status`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "end" }),
  });

  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(
      `Zoom endMeeting error ${res.status}: ${JSON.stringify(body) || res.statusText}`
    );
  }
}

/* -------------------------- Convenience wrappers -------------------------- */

/**
 * (Compatibility) If you still call with { topic, date, time, durationMinutes },
 * this helper converts to the proper shape and calls `createMeeting`.
 * - date: "YYYY-MM-DD"
 * - time: "HH:MM" OR "HH:MM-HH:MM" (24h)
 */
export async function createZoomMeetingFromSessionFields({
  topic,
  date,
  time,
  durationMinutes = 30,
  hostEmail = process.env.ZOOM_DEFAULT_HOST_EMAIL,
}) {
  const { startISO, duration } = parseDateTimeToISO(date, time, durationMinutes);
  const m = await createMeeting({
    hostEmail,
    topic,
    start_time: startISO,
    duration,
    agenda: undefined,
  });
  return {
    meetingId: m.meetingId,
    joinUrl: m.joinUrl,
    startUrl: m.startUrl,
    password: m.password,
    linkCreatedAt: new Date(),
    linkExpiresAt: new Date(Date.now() + duration * 60000),
    durationMinutes: duration,
  };
}

/**
 * (Optional fallback) Internal room link — kept from your previous stub, unchanged.
 */
export async function createInternalMeetingLink({ sessionId }) {
  const joinUrl = `https://your-app.example.com/room/${sessionId}`;
  return {
    meetingId: sessionId,
    joinUrl,
    linkCreatedAt: new Date(),
    linkExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

/* --------------------------------- Helpers -------------------------------- */

function parseDateTimeToISO(date, time, durationMinutes) {
  // Accept "HH:MM" or "HH:MM-HH:MM"
  let startHour = 0,
    startMin = 0,
    computedDuration = durationMinutes;

  if (time && time.includes("-")) {
    const [s, e] = time.split("-");
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    startHour = sh;
    startMin = sm;
    const startMs = sh * 60 + sm;
    const endMs = eh * 60 + em;
    const diff = endMs - startMs;
    if (diff > 0) computedDuration = diff;
  } else if (time) {
    const [h, m] = time.split(":").map(Number);
    startHour = h;
    startMin = m || 0;
  }

  // Build a UTC ISO string for Zoom
  const dt = new Date(Date.UTC(...ymd(date), startHour, startMin, 0));
  return { startISO: dt.toISOString(), duration: computedDuration || 30 };
}

function ymd(dateStr) {
  // "YYYY-MM-DD" → [YYYY, MM-1, DD]
  const [y, m, d] = dateStr.split("-").map(Number);
  return [y, (m - 1), d];
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/* ------------------------------- Legacy note ------------------------------ */
/**
 * You previously exported `createZoomMeetingStub(...)`. If any code still imports
 * that name, you can temporarily re-export the new wrapper under the old name:
 *
 *   export const createZoomMeetingStub = createZoomMeetingFromSessionFields;
 *
 * Uncomment the line below if you need backward compatibility right now.
 */
// export const createZoomMeetingStub = createZoomMeetingFromSessionFields;
