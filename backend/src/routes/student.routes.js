// src/routes/student.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import Student from "../models/student.js";
import User from "../models/user.js";
import cloudinary from "../utils/cloudinary.js";

const router = Router();

// Multer setup for photo upload
const MAX_AVATAR_MB = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_MB * 1024 * 1024 },
});

// upload helper
async function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "ShikshaDaan/students", resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

/**
 * GET /api/students
 * Optional: ?interest=XYZ
 * Public list of students (shaped for frontend)
 */
router.get("/", async (req, res) => {
  try {
    const { interest } = req.query;
    const q = {};
    if (interest) {
      q.interests = { $regex: new RegExp(interest, "i") };
    }

    // populate user name (assumes Student.userId is ref to User)
    const students = await Student.find(q)
      .select("-__v")
      .populate("userId", "name")
      .limit(50)
      .lean();

    const shaped = (students || []).map((s) => ({
      _id: s._id,
      userId: s.userId?._id || s.userId,
      name: s.userId?.name || null,
      college: s.college || null,
      course: s.course || null,
      year: s.year || null,
      interests: s.interests || [],
      bio: s.bio || null,
      photoUrl: s.profilePicture?.url || null,
    }));

    res.json(shaped);
  } catch (err) {
    console.error("GET /students failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/students/:userId
 * Public student profile (flattened)
 */
router.get("/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const profile = await Student.findOne({ userId })
      .select("-__v")
      .lean();

    if (!profile) return res.status(404).json({ message: "Student profile not found" });

    // also include user's name if available
    let userDoc = null;
    try {
      userDoc = await User.findById(userId).select("name role").lean();
    } catch (e) { /* ignore */ }

    // shape profile for frontend
    const shaped = {
      _id: profile._id,
      userId: profile.userId,
      college: profile.college || null,
      course: profile.course || null,
      year: profile.year || null,
      academicLevel: profile.academicLevel || null,
      interests: profile.interests || [],
      skillsToLearn: profile.skillsToLearn || [],
      languages: profile.languages || [],
      bio: profile.bio || null,
      profilePicture: profile.profilePicture || null,
      photoUrl: profile.profilePicture?.url || null,
      // include any other fields you want to expose from student schema:
      // e.g., completedSessions, badges etc. (if present)
    };

    return res.json({
      profile: shaped,
      user: { _id: userDoc?._id || userId, name: userDoc?.name || null, role: userDoc?.role || 'student' }
    });
  } catch (err) {
    console.error("GET /students/:userId failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PUT /api/students/me
 * Update own profile
 */
router.put("/me", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const allowed = [
      "college",
      "course",
      "year",
      "academicLevel",
      "interests",
      "skillsToLearn",
      "languages",
      "bio",
    ];

    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    const profile = await Student.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    // attach photoUrl if exists
    const shaped = { ...profile, photoUrl: profile?.profilePicture?.url || null };

    res.json(shaped);
  } catch (err) {
    console.error("PUT /students/me failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/students/me
 * returns your own student profile (flattened)
 */
router.get("/me", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const profile = await Student.findOne({ userId: req.user._id }).lean();
    if (!profile) return res.json(null);
    return res.json({ ...profile, photoUrl: profile.profilePicture?.url || null });
  } catch (err) {
    console.error("GET /students/me failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/students/me/photo
 * Upload avatar
 */
router.post(
  "/me/photo",
  requireAuth,
  requireRole("student"),
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      let profile = await Student.findOne({ userId: req.user._id });
      if (!profile) profile = new Student({ userId: req.user._id });

      // delete old avatar
      if (profile.profilePicture?.publicId) {
        try {
          await cloudinary.uploader.destroy(profile.profilePicture.publicId);
        } catch (e) {
          console.warn("Failed to delete old avatar:", e?.message || e);
        }
      }

      // upload new
      const result = await uploadToCloudinary(req.file.buffer);
      profile.profilePicture = {
        url: result.secure_url,
        publicId: result.public_id,
      };
      await profile.save();

      const shaped = profile.toObject();
      shaped.photoUrl = shaped.profilePicture?.url || null;

      res.json(shaped);
    } catch (err) {
      console.error("POST /students/me/photo failed:", err);
      res.status(500).json({
        message: "Server error",
        error: err.message,
      });
    }
  }
);

export default router;
