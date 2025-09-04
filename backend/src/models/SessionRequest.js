// src/models/SessionRequest.js
import mongoose from "mongoose";

const sessionRequestSchema = new mongoose.Schema(
  {
    // Who initiated the request (student or volunteer)
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Student involved in the session
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Volunteer involved in the session
    volunteer: {
      type: mongoose.Schema.Types.ObjectId,
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
        "pending",   // request created
        "accepted",  // volunteer accepted
        "rejected",  // volunteer rejected
        "scheduled", // confirmed with date/time
        "completed", // session done
        "cancelled"  // cancelled by either party
      ],
      default: "pending",
    },

    // Proposed schedule (by student or volunteer)
    proposed: {
      date: String,
      time: String,
    },

    // Final confirmed schedule (set after acceptance)
    final: {
      date: String,
      time: String,
      zoomLink: String, // generated from Zoom service
    },

    // Extra metadata
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      comment: String,
    },
  },
  { timestamps: true }
);

export default mongoose.model("SessionRequest", sessionRequestSchema);
