// src/routes/student.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import Student from "../models/student.js";
import User from "../models/user.js"; // <-- added
import cloudinary from "../utils/cloudinary.js";

const router = Router();

/**
 * GET /api/students/me
 * Get current student's profile (returns empty object if no profile exists yet)
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = await Student.findOne({ userId }).lean();
    // If no profile exists yet, return empty object instead of 404
    if (!profile) return res.json({});
    
    // Get user data
    const user = await User.findById(userId).select('name email').lean();
    
    // Normalize photo URL
    const photoUrl = profile.profilePicture?.url || profile.photoUrl || null;
    
    return res.json({
      ...profile,
      name: user?.name,
      email: user?.email,
      photoUrl // maintain backward compatibility
    });
  } catch (err) {
    console.error('Error in GET /api/students/me:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

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
 * GET /api/students/:userId
 * Public student profile (includes name + photoUrl)
 */
/**
 * GET /api/students/:userId
 * Public student profile (includes name + photoUrl)
 */
router.get("/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const profile = await Student.findOne({ userId }).lean();
    if (!profile) return res.status(404).json({ message: "Student profile not found" });

    const u = await User.findById(userId).select("name email").lean();

    // normalize photo url if present
    const photoUrl = profile.profilePicture?.url || profile.photoUrl || null;

    return res.json({
      ...profile,
      name: u?.name || null,
      email: u?.email || null,
      photoUrl
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

    res.json(profile);
  } catch (err) {
    console.error("PUT /students/me failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/students?interest=XYZ
router.get("/", async (req, res) => {
  try {
    const { interest } = req.query;
    let query = {};
    if (interest) {
      query.interests = { $regex: new RegExp(interest, "i") }; // case insensitive match
    }

    const students = await Student.find(query).select("-__v").lean();

    // attach name/photo for each student from User document if exists
    const userIds = students.map(s => s.userId).filter(Boolean);
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name email").lean() : [];
    const userMap = new Map(users.map(u => [String(u._id), u]));

    const shaped = students.map(s => {
      const u = userMap.get(String(s.userId)) || {};
      return {
        ...s,
        name: u.name || null,
        email: u.email || null,
        photoUrl: s.profilePicture?.url || s.photoUrl || null
      };
    });

    res.json(shaped);
  } catch (err) {
    console.error("GET /students failed:", err);
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

      const profileObj = profile.toObject();
      const u = await User.findById(req.user._id).select("name email").lean();
      res.json({
        ...profileObj,
        name: u?.name || null,
        email: u?.email || null,
        photoUrl: profile.profilePicture?.url || null
      });
    } catch (err) {
      console.error("POST /students/me/photo failed:", err);
      // 🔥 include real error
      res.status(500).json({
        message: "Server error",
        error: err.message,
        stack: err.stack,
      });
    }
  }
);

export default router;
