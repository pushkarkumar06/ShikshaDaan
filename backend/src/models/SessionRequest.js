import mongoose from "mongoose";

const sessionRequestSchema = new mongoose.Schema({
  volunteer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // user with role volunteer
  target: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },   // student or admin
  subject: String,
  message: String,
  status: { type: String, enum: ["pending", "accepted", "rejected", "scheduled"], default: "pending" },
  proposed: {
    date: String,  // proposer date
    time: String
  },
  final: {
    date: String,
    time: String,
    zoomLink: String
  }
}, { timestamps: true });

export default mongoose.model("SessionRequest", sessionRequestSchema);
