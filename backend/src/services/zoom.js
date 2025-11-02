// src/services/zoom.js
// ES module version – works with your current import style

/**
 * ENV required:
 *  - ZOOM_ACCOUNT_ID
 *  - ZOOM_CLIENT_ID
 *  - ZOOM_CLIENT_SECRET
 *  - ZOOM_DEFAULT_HOST_EMAIL
 *
 * Optional:
 *  - ZOOM_WEBHOOK_SECRET_TOKEN   (used by your webhook route)
 */

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE  = "https://api.zoom.us/v2";

// Node 18+ has global fetch; no need to import
let _cachedToken = null;
let _cachedExp   = 0; // epoch seconds

/* -------------------------------------------------------------------------- */
/*                               Auth / Token                                 */
/* -------------------------------------------------------------------------- */

/** Fetch (and cache) a Server-to-Server OAuth access token */
export async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && now < _cachedExp - 60) return _cachedToken;

  const accountId    = (process.env.ZOOM_ACCOUNT_ID || "").trim();
  const clientId     = (process.env.ZOOM_CLIENT_ID || "").trim();
  const clientSecret = (process.env.ZOOM_CLIENT_SECRET || "").trim();
  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Zoom S2S OAuth env vars missing (ZOOM_ACCOUNT_ID/ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET).");
  }

  const params = new URLSearchParams({
    grant_type: "account_credentials",
    account_id: accountId,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${ZOOM_TOKEN_URL}?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(`Zoom token error ${res.status}: ${JSON.stringify(body) || res.statusText}`);
  }

  const data = await res.json(); // { access_token, token_type, expires_in }
  _cachedToken = data.access_token;
  _cachedExp   = Math.floor(Date.now() / 1000) + (data.expires_in || 0);
  return _cachedToken;
}

/* -------------------------------------------------------------------------- */
/*                                Meetings API                                */
/* -------------------------------------------------------------------------- */

/**
 * Create a scheduled Zoom meeting.
 *
 * @param {Object} opts
 * @param {string} opts.hostEmail               Zoom user email to OWN/host the meeting
 * @param {string} opts.topic                   Meeting topic
 * @param {string} opts.start_time              ISO8601 UTC string ("YYYY-MM-DDTHH:mm:ssZ")
 * @param {number} [opts.duration=30]           Minutes
 * @param {string} [opts.agenda]                Optional agenda
 * @param {boolean} [opts.waitingRoom=true]     Waiting room on/off
 * @param {string[]} [opts.alternativeHosts=[]] Optional alternative hosts (emails in same Zoom account)
 * @returns {Promise<{meetingId:string,startUrl:string,joinUrl:string,password?:string,raw:any}>}
 */
export async function createMeeting({
  hostEmail = process.env.ZOOM_DEFAULT_HOST_EMAIL,
  topic,
  start_time,
  duration = 30,
  agenda,
  waitingRoom = true,
  alternativeHosts = [],
}) {
  if (!hostEmail) throw new Error("hostEmail missing");
  if (!topic) topic = "ShikshaDaan Session";
  if (!start_time) throw new Error("start_time (ISO) missing");

  const token = await getAccessToken();
  const url   = `${ZOOM_API_BASE}/users/${encodeURIComponent(hostEmail)}/meetings`;

  const payload = {
    topic,
    type: 2,                 // 2 = scheduled
    start_time,              // ISO8601 UTC string
    duration,                // minutes
    agenda,
    settings: {
      host_video: true,
      participant_video: true,
      mute_upon_entry: true,
      join_before_host: false,
      waiting_room: !!waitingRoom,
      approval_type: 2,      // 2 = no registration required (0=auto approve, 1=manual approve, 2=none)
      alternative_hosts: Array.isArray(alternativeHosts) && alternativeHosts.length
        ? alternativeHosts.join(",")
        : undefined,
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
    throw new Error(`Zoom createMeeting error ${res.status}: ${JSON.stringify(body) || res.statusText}`);
  }

  const z = await res.json();
  return {
    meetingId: String(z.id),
    startUrl: z.start_url,
    joinUrl:  z.join_url,
    password: z.password,
    raw:      z,
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
    throw new Error(`Zoom endMeeting error ${res.status}: ${JSON.stringify(body) || res.statusText}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                       Convenience / Backward-compat                        */
/* -------------------------------------------------------------------------- */

/**
 * Create a meeting from { date, time } pair.
 * - date: "YYYY-MM-DD"
 * - time: "HH:MM" OR "HH:MM-HH:MM" (24h)
 */
export async function createZoomMeetingFromSessionFields({
  topic,
  date,
  time,
  durationMinutes = 30,
  hostEmail = process.env.ZOOM_DEFAULT_HOST_EMAIL,
  waitingRoom = true,
  alternativeHosts = [],
}) {
  const { startISO, duration } = parseDateTimeToISO(date, time, durationMinutes);
  const m = await createMeeting({
    hostEmail,
    topic,
    start_time: startISO,
    duration,
    agenda: undefined,
    waitingRoom,
    alternativeHosts,
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
 * Optional internal-room stub (unchanged).
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

/* -------------------------------------------------------------------------- */
/*                                   Utils                                    */
/* -------------------------------------------------------------------------- */

function parseDateTimeToISO(date, time, durationMinutes) {
  // Accept "HH:MM" or "HH:MM-HH:MM"
  let startHour = 0, startMin = 0, computedDuration = durationMinutes;

  if (time && time.includes("-")) {
    const [s, e] = time.split("-");
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    startHour = sh; startMin = sm;
    const startM = sh * 60 + sm;
    const endM   = eh * 60 + em;
    const diff   = endM - startM;
    if (diff > 0) computedDuration = diff;
  } else if (time) {
    const [h, m] = time.split(":").map(Number);
    startHour = h; startMin = m || 0;
  }

  const dt = new Date(Date.UTC(...ymd(date), startHour, startMin, 0));
  return { startISO: dt.toISOString(), duration: computedDuration || 30 };
}

function ymd(dateStr) {
  const [y, m, d] = (dateStr || "").split("-").map(Number);
  return [y, (m - 1), d];
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// If old code still imports createZoomMeetingStub:
// export const createZoomMeetingStub = createZoomMeetingFromSessionFields;
