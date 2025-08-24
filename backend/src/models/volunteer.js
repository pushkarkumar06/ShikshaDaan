import mongoose from "mongoose";

const volunteerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
  education: String,
  experience: String,
  bio: String,
  subjects: [String],
  languages: [String],
  hourlyRate: Number, // optional
  availability: [{
    date: String, // ISO date or "YYYY-MM-DD"
    slots: [String] // "09:00-09:30"
  }],
  avgRating: { type: Number, default: 0 },
  ratingsCount: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model("Volunteer", volunteerSchema);
