// src/models/SessionRequest.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const finalSchema = new Schema(
  {
    date: { type: String },
    time: { type: String },
    zoomLink: { type: String },
    meetingId: { type: String }, // optional provider-specific id
    linkCreatedAt: { type: Date },
    linkExpiresAt: { type: Date },
    durationMinutes: { type: Number }, // scheduled length in minutes
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

    // Status tracking
    status: {
      type: String,
      enum: [
        "pending", // request created
        "accepted", // volunteer accepted (no time)
        "rejected", // volunteer rejected
        "scheduled", // confirmed with date/time
        "in-progress", // optional runtime state
        "completed", // session done
        "cancelled", // cancelled by either party
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

    // Final confirmed schedule (set after acceptance)
    final: { type: finalSchema, default: {} },

    // Extra metadata
    feedback: { type: feedbackSchema, default: {} },

    // optional room id for internal WebRTC fallback
    sessionRoomId: { type: String },

    // optional flags / notes
    notes: { type: String },
  },
  { timestamps: true }
);

// ----------------- Statics / helpers -----------------

/**
 * Check whether a volunteer already has a scheduled session at given date+time.
 * - date: "YYYY-MM-DD"
 * - time: "HH:MM" or "HH:MM-HH:MM" (we match startsWith for simple slot strings)
 * - excludeId: optional ObjectId (string) to exclude (useful when updating same request)
 *
 * Returns: Promise<boolean>
 */
sessionRequestSchema.statics.isSlotTaken = async function (volunteerId, date, time, excludeId = null) {
  if (!volunteerId || !date || !time) return false;
  const q = {
    volunteer: mongoose.Types.ObjectId(String(volunteerId)),
    status: { $in: ["scheduled", "in-progress"] },
    "final.date": date,
    // match exact time or slots that start with same time (handles "11:30-12:00")
    $or: [{ "final.time": time }, { "final.time": { $regex: `^${time}` } }],
  };
  if (excludeId) {
    try {
      q._id = { $ne: mongoose.Types.ObjectId(String(excludeId)) };
    } catch (e) {
      // ignore invalid excludeId
    }
  }
  const exists = await this.exists(q);
  return !!exists;
};

/**
 * Create a short helper that marks a session as scheduled and fills final fields.
 * Accepts an object: { date, time, durationMinutes, zoomLink, meetingId, linkCreatedAt, linkExpiresAt }
 */
sessionRequestSchema.methods.markScheduled = function (opts = {}) {
  const { date, time, durationMinutes, zoomLink, meetingId, linkCreatedAt, linkExpiresAt } = opts;
  this.status = "scheduled";
  this.final = this.final || {};
  if (date) this.final.date = date;
  if (time) this.final.time = time;
  if (typeof durationMinutes === "number") this.final.durationMinutes = durationMinutes;
  if (zoomLink) this.final.zoomLink = zoomLink;
  if (meetingId) this.final.meetingId = meetingId;
  if (linkCreatedAt) this.final.linkCreatedAt = linkCreatedAt;
  if (linkExpiresAt) this.final.linkExpiresAt = linkExpiresAt;
  this.scheduledAt = this.scheduledAt || new Date(); // optional quick marker
  return this;
};

// Ensure model uses sensible toJSON behavior (convert _id to id)
sessionRequestSchema.set("toJSON", {
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret.__v;
    return ret;
  },
});

// Index final.date + final.time for faster lookups
sessionRequestSchema.index({ "final.date": 1, "final.time": 1, volunteer: 1, status: 1 });

export default mongoose.model("SessionRequest", sessionRequestSchema);
