// src/models/SessionRequest.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Final (confirmed) schedule for the session.
 * Kept compatible with your previous structure and augmented with ISO fields.
 */
const finalSchema = new Schema(
  {
    date: { type: String },                  // "YYYY-MM-DD" (local date you store/display)
    time: { type: String },                  // "HH:MM" or "HH:MM-HH:MM"

    // ISO start/end (UTC) are convenient for timers/schedulers and Zoom API
    startISO: { type: String },              // e.g., "2025-10-09T11:30:00Z"
    endISO: { type: String },                // e.g., "2025-10-09T12:00:00Z"

    // Legacy link fields (still returned to clients)
    zoomLink: { type: String },
    meetingId: { type: String },             // provider-specific id (legacy)
    linkCreatedAt: { type: Date },
    linkExpiresAt: { type: Date },
    durationMinutes: { type: Number },       // scheduled length in minutes
  },
  { _id: false }
);

/**
 * Zoom meeting info (new).
 * We keep this separate from `final` to store provider details cleanly.
 */
const zoomMeetingSchema = new Schema(
  {
    meetingId: { type: String },             // numeric/string id from Zoom
    startUrl: { type: String },              // host link
    joinUrl: { type: String },               // participant link
    password: { type: String },
    hostEmail: { type: String },
    createdAt: { type: Date },
  },
  { _id: false }
);

const feedbackSchema = new Schema(
  {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String },
  },
  { _id: false }
);

const AttendanceSchema = new Schema({
  joinedAt: Date,
  leftAt: Date,
}, { _id: false });

const sessionRequestSchema = new Schema(
  {
    // Who initiated the request (student or volunteer)
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Student involved in the session
    student: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Volunteer involved in the session
    volunteer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Core details
    subject: { type: String, required: true },
    message: { type: String },

    // who actually joined/left
    attendance: {
      student: { type: AttendanceSchema, default: () => ({}) },
      volunteer: { type: AttendanceSchema, default: () => ({}) },
    },

    // Status tracking (kept your original names)
    status: {
      type: String,
      enum: [
        "pending",       // request created
        "accepted",      // accepted but final time not necessarily set
        "rejected",
        "scheduled",     // confirmed with date/time
        "in-progress",   // runtime (note: your UI already uses this style)
        "completed",
        "cancelled",
        "expired",
      ],
      default: "pending",
      index: true,
    },

    // Proposed schedule (by student or volunteer)
    proposed: {
      date: String, // "YYYY-MM-DD"
      time: String, // "HH:MM" or "HH:MM-HH:MM"
      zoomLink: String,
    },

    // Final confirmed schedule (after acceptance)
    final: { type: finalSchema, default: {} },

    // Zoom provider details (created when Generate & Join is clicked)
    zoomMeeting: { type: zoomMeetingSchema, default: {} },

    // Extra metadata
    feedback: { type: feedbackSchema, default: {} },

    // optional room id for internal WebRTC fallback
    sessionRoomId: { type: String },

    // optional flags / notes
    notes: { type: String },

    // Quick marker for when it became scheduled (optional)
    scheduledAt: { type: Date },
  },
  { timestamps: true }
);

/* ------------------------------ Static helpers ------------------------------ */

/**
 * Check whether a volunteer already has a scheduled session at given date+time.
 * - date: "YYYY-MM-DD"
 * - time: "HH:MM" or "HH:MM-HH:MM" (we match startsWith for simple slot strings)
 * - excludeId: optional ObjectId (string) to exclude (useful when updating same request)
 *
 * Returns: Promise<boolean>
 */
sessionRequestSchema.statics.isSlotTaken = async function (
  volunteerId,
  date,
  time,
  excludeId = null
) {
  if (!volunteerId || !date || !time) return false;
  const q = {
    volunteer: mongoose.Types.ObjectId(String(volunteerId)),
    status: { $in: ["scheduled", "in-progress"] },
    "final.date": date,
    $or: [{ "final.time": time }, { "final.time": { $regex: `^${time}` } }],
  };
  if (excludeId) {
    try {
      q._id = { $ne: mongoose.Types.ObjectId(String(excludeId)) };
    } catch {
      // ignore invalid excludeId
    }
  }
  const exists = await this.exists(q);
  return !!exists;
};

/* ------------------------------ Instance helpers ------------------------------ */

/**
 * Mark as scheduled and fill final fields.
 * Accepts: { date, time, durationMinutes, zoomLink, meetingId, linkCreatedAt, linkExpiresAt, startISO, endISO }
 * ISO fields are optional; if omitted, we’ll try to derive from (date,time,durationMinutes).
 */
sessionRequestSchema.methods.markScheduled = function (opts = {}) {
  const {
    date,
    time,
    durationMinutes,
    zoomLink,
    meetingId,
    linkCreatedAt,
    linkExpiresAt,
    startISO,
    endISO,
  } = opts;

  this.status = "scheduled";
  this.final = this.final || {};

  if (date) this.final.date = date;
  if (time) this.final.time = time;
  if (typeof durationMinutes === "number") this.final.durationMinutes = durationMinutes;
  if (zoomLink) this.final.zoomLink = zoomLink;
  if (meetingId) this.final.meetingId = meetingId;
  if (linkCreatedAt) this.final.linkCreatedAt = linkCreatedAt;
  if (linkExpiresAt) this.final.linkExpiresAt = linkExpiresAt;

  // ISO handling
  if (startISO) this.final.startISO = startISO;
  if (endISO) this.final.endISO = endISO;

  // Derive ISO if missing and local date/time are present
  if (!this.final.startISO && this.final.date && this.final.time) {
    const { startISO: derivedStart, endISO: derivedEnd } = deriveISOFromLocal(
      this.final.date,
      this.final.time,
      this.final.durationMinutes || 30
    );
    this.final.startISO = derivedStart;
    this.final.endISO = this.final.endISO || derivedEnd;
  }

  this.scheduledAt = this.scheduledAt || new Date();
  return this;
};

/**
 * Convenience getters (Dates). If not set, returns null.
 */
sessionRequestSchema.methods.getStartDate = function () {
  return this.final?.startISO ? new Date(this.final.startISO) : null;
};
sessionRequestSchema.methods.getEndDate = function () {
  return this.final?.endISO ? new Date(this.final.endISO) : null;
};

/**
 * T-10 minutes rule check (server-side).
 * Returns true if now is within 10 minutes before start and up to 60 minutes after start.
 */
sessionRequestSchema.methods.isWithinGenerateWindow = function (now = Date.now()) {
  const start = this.getStartDate();
  if (!start) return false;
  const startMs = start.getTime();
  const n = typeof now === "number" ? now : now.getTime();
  return startMs - n <= 10 * 60 * 1000 && n <= startMs + 60 * 60 * 1000;
};

/* ------------------------------ JSON & Indexes ------------------------------ */

sessionRequestSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret.__v;
    return ret;
  },
});

// Useful indexes for lookups and calendars
sessionRequestSchema.index({ "final.date": 1, "final.time": 1, volunteer: 1, status: 1 });
sessionRequestSchema.index({ "final.startISO": 1, volunteer: 1, status: 1 });

export default mongoose.model("SessionRequest", sessionRequestSchema);

/* --------------------------------- Helpers --------------------------------- */

function deriveISOFromLocal(dateStr, timeStr, durationMinutes = 30) {
  // Accept "HH:MM" or "HH:MM-HH:MM" (24h)
  let startH = 0,
    startM = 0,
    dur = durationMinutes;

  if (timeStr.includes("-")) {
    const [s, e] = timeStr.split("-");
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    startH = sh || 0;
    startM = sm || 0;
    const diffMin = (eh * 60 + (em || 0)) - (startH * 60 + startM);
    if (diffMin > 0) dur = diffMin;
  } else {
    const [h, m] = timeStr.split(":").map(Number);
    startH = h || 0;
    startM = m || 0;
  }

  // We don't know user's timezone here; safest is to store UTC ISO derived from local
  // by treating the local time as if it were already UTC (consistent with your previous data).
  // If you later add timezone support, convert here before toISOString().
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, (m - 1), d, startH, startM, 0));
  const end = new Date(start.getTime() + dur * 60000);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}
