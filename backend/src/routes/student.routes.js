// src/routes/student.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import Student from "../models/student.js";
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
 * GET /api/students/:userId
 * Public student profile
 */
router.get("/:userId", async (req, res) => {
  try {
    const userId = req.params.userId.trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const profile = await Student.findOne({ userId }).lean();
    if (!profile) return res.status(404).json({ message: "Student profile not found" });

    res.json(profile);
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
    res.json(students);
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

      res.json(profile.toObject());
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