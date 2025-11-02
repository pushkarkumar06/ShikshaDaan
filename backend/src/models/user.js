
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, index: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["volunteer", "student", "admin"], required: true },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  badges: [{ // achievements
    key: String, // e.g. sessions_5, top_rated
    label: String,
    earnedAt: Date
  }]
}, { timestamps: true });

export default mongoose.model("User", userSchema);
