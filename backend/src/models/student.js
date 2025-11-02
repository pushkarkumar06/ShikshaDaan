// src/models/student.js
import mongoose from "mongoose";

const AvatarSchema = new mongoose.Schema(
  {
    publicId: String,
    url: String,
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
      index: true,
    },

    // Profile fields
    college: { type: String },
    course: { type: String },
    year: { type: String },
    academicLevel: {
      type: String,
      enum: ["School", "Undergraduate", "Postgraduate", "Other"],
      default: "Other",
    },
    interests: [{ type: String }], // e.g., "Math", "Coding", "Physics"
    skillsToLearn: [{ type: String }], // more specific goals
    languages: [{ type: String }], // e.g., "English", "Hindi"
    bio: { type: String },
    profilePicture: AvatarSchema,

    // Networking
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Sessions
    sessions: [{ type: mongoose.Schema.Types.ObjectId, ref: "SessionRequest" }],

    // Notifications
    notifications: [{ type: mongoose.Schema.Types.ObjectId, ref: "Notification" }],

    // Stats (for dashboard)
    stats: {
      sessionsBooked: { type: Number, default: 0 },
      sessionsCompleted: { type: Number, default: 0 },
      reviewsGiven: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Student", studentSchema);
