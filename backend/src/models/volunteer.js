// models/volunteer.js
import mongoose from "mongoose";

const AvatarSchema = new mongoose.Schema(
  {
    publicId: String,      // Cloudinary public_id
    url: String,           // secure_url (prefer https)
    width: Number,
    height: Number,
    format: String,        // jpg/png/webp
    bytes: Number,
    folder: String,        // e.g. "ShikshaDaan/avatars"
  },
  { _id: false }
);


const LocationSchema = new mongoose.Schema(
  {
    city: String,
    state: String,
    country: String,
    lat: Number,  // optional, if you ever geocode
    lng: Number,  // optional
  },
  { _id: false }
);

const volunteerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
      index: true,
    },

    // Rich Profile fields
    avatar: AvatarSchema,                   // Cloudinary result
    location: LocationSchema,               // city/state/country (optional)
    timezone: String,                       // e.g. "Asia/Kolkata"
    hourlyRate: { type: Number, default: 0, min: 0 }, // can be 0 for free
    specialties: [{ type: String }],        // e.g. "STEM mentor", "Exam prep"

    // Existing profile fields
    education: String,
    experience: String,
    bio: String,
    subjects: [{ type: String }],
    languages: [{ type: String }],

    // Availability
    availability: [
      {
        date: String,       // ISO date: "YYYY-MM-DD"
        slots: [String],    // e.g. "09:00-09:30"
      },
    ],

    // Ratings (aggregated)
    avgRating: { type: Number, default: 0 },
    ratingsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/**
 * Normalize array fields (trim empties, dedupe, lower-case for consistency).
 * This keeps your filters consistent and avoids ["Math", " math "] duplicates.
 */
function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  const clean = arr
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  // keep original case for display but you can lower-case if you prefer:
  // return [...new Set(clean.map(s => s.toLowerCase()))];
  return [...new Set(clean)];
}

volunteerSchema.pre("save", function (next) {
  this.subjects = normalizeStringArray(this.subjects);
  this.languages = normalizeStringArray(this.languages);
  this.specialties = normalizeStringArray(this.specialties);
  next();
});

export default mongoose.model("Volunteer", volunteerSchema);
