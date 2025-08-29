// src/routes/volunteer.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";

import { requireAuth, requireRole } from "../middleware/auth.js";
import Volunteer from "../models/volunteer.js";
import Review from "../models/Review.js";
import cloudinary from "../utils/cloudinary.js";

const router = Router();

/* ======================================
   Helpers / Multer (avatar upload only)
   ====================================== */
const MAX_AVATAR_MB = parseInt(process.env.MAX_AVATAR_MB || "6", 10);
const AVATAR_FOLDER = process.env.CLOUDINARY_AVATAR_FOLDER || "ShikshaDaan/avatars";

// Quick health check for Cloudinary config (helps produce 1 clear error)
function assertCloudinaryConfig() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    const msg = "Cloudinary env missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.";
    const err = new Error(msg);
    err.statusCode = 500;
    throw err;
  }
}

const imageMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const avatarFilter = (_req, file, cb) => {
  if (!imageMimes.has(file.mimetype)) return cb(new Error("Only image uploads are allowed"));
  cb(null, true);
};
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  fileFilter: avatarFilter,
  limits: { fileSize: MAX_AVATAR_MB * 1024 * 1024 },
});

// upload buffer to Cloudinary
function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: AVATAR_FOLDER,
        resource_type: "image",
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// unified handler to finish avatar update after multer
async function setAvatarFromUpload(req, res) {
  try {
    assertCloudinaryConfig();

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "No file uploaded. Use form-data field: avatar" });
    }

    // ensure profile doc exists
    let vol = await Volunteer.findOne({ userId: req.user._id });
    if (!vol) vol = await Volunteer.create({ userId: req.user._id });

    // delete old avatar if present (non-fatal if it fails)
    const oldPublicId = vol?.profilePicture?.publicId;
    if (oldPublicId) {
      try {
        await cloudinary.uploader.destroy(oldPublicId);
      } catch (e) {
        console.warn("Cloudinary destroy (old avatar) failed:", e?.message || e);
      }
    }

    // upload new
    const result = await uploadBufferToCloudinary(req.file.buffer);
    vol.profilePicture = { url: result.secure_url, publicId: result.public_id };
    await vol.save();

    const profile = await Volunteer.findById(vol._id).lean();
    return res.json({
      message: "Avatar updated",
      photoUrl: profile?.profilePicture?.url || null,
      profile,
    });
  } catch (err) {
    console.error("Avatar upload error:", err?.message || err);
    return res
      .status(err.statusCode || 500)
      .json({ message: err.message || "Server error" });
  }
}

/* =========================
   LIST VOLUNTEERS
   ========================= */
router.get("/", async (req, res) => {
  try {
    const { subject } = req.query;
    const q = subject ? { subjects: subject } : {};
    const list = await Volunteer.find(q)
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone profilePicture"
      )
      .limit(20)
      .lean();
    return res.json(list);
  } catch (err) {
    console.error("GET /volunteers failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   UPDATE OWN PROFILE
   ========================= */
router.put("/me", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const allowed = [
      "education",
      "experience",
      "bio",
      "subjects",
      "languages",
      "hourlyRate",
      "availability",
      "specialties",
      "location",
      "timezone",
    ];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    const profile = await Volunteer.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    return res.json(profile);
  } catch (err) {
    console.error("PUT /volunteers/me failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   GET OWN PROFILE (helpful for FE)
   ========================= */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const profile = await Volunteer.findOne({ userId: req.user._id }).lean();
    if (!profile) return res.json(null);
    return res.json(profile);
  } catch (err) {
    console.error("GET /volunteers/me failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   GET PUBLIC PROFILE (+reviews)
   ========================= */
router.get("/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const profile = await Volunteer.findOne({ userId })
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone availability avgRating ratingsCount profilePicture"
      )
      .lean();

    if (!profile) return res.status(404).json({ message: "Volunteer profile not found" });

    const reviews = await Review.find({ volunteer: userId })
      .populate("author", "name")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ profile, reviews });
  } catch (err) {
    console.error("GET /volunteers/:userId failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   AVAILABILITY
   ========================= */
const SLOT_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const isValidSlot = (s) => SLOT_REGEX.test(s);
const normalizeDate = (d) => (d || "").trim();

router.get("/:userId/availability", async (req, res) => {
  try {
    const userId = (req.params.userId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const { from, to } = req.query;
    const vol = await Volunteer.findOne({ userId }, { availability: 1, _id: 0 }).lean();
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    let avail = vol.availability || [];
    if (from || to) {
      avail = avail.filter((a) => {
        const d = a.date;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return res.json(avail);
  } catch (err) {
    console.error("GET availability failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/me/availability", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const date = normalizeDate(req.body.date);
    const slots = Array.isArray(req.body.slots) ? req.body.slots.filter(isValidSlot) : [];
    if (!date) return res.status(400).json({ message: "date required (YYYY-MM-DD)" });

    const vol =
      (await Volunteer.findOne({ userId: req.user._id })) ||
      (await Volunteer.create({ userId: req.user._id, availability: [] }));

    let updated = false;
    vol.availability = (vol.availability || []).map((a) => {
      if (a.date === date) {
        updated = true;
        return { date, slots: [...new Set(slots)] };
      }
      return a;
    });
    if (!updated) vol.availability.push({ date, slots: [...new Set(slots)] });

    await vol.save();
    return res.json(vol.availability);
  } catch (err) {
    console.error("PUT /me/availability failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/me/availability", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const date = normalizeDate(req.body.date);
    const slot = (req.body.slot || "").trim();
    const action = (req.body.action || "add").trim();
    if (!date || !isValidSlot(slot)) {
      return res.status(400).json({ message: "Invalid date or slot" });
    }

    const vol =
      (await Volunteer.findOne({ userId: req.user._id })) ||
      (await Volunteer.create({ userId: req.user._id, availability: [] }));

    vol.availability ||= [];
    let day = vol.availability.find((a) => a.date === date);
    if (!day) {
      day = { date, slots: [] };
      vol.availability.push(day);
    }

    if (action === "remove") {
      day.slots = day.slots.filter((s) => s !== slot);
    } else if (!day.slots.includes(slot)) {
      day.slots.push(slot);
    }

    await vol.save();
    return res.json(day);
  } catch (err) {
    console.error("PATCH /me/availability failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   AVATAR UPLOAD / DELETE
   ========================= */

// Primary endpoint
router.post(
  "/me/avatar",
  requireAuth,
  requireRole("volunteer"),
  (req, res, next) => {
    const handler = uploadAvatar.single("avatar");
    handler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const code = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(code).json({
          message:
            err.code === "LIMIT_FILE_SIZE"
              ? `File too large. Max ${MAX_AVATAR_MB}MB`
              : err.message,
        });
      }
      if (err) return res.status(400).json({ message: err.message || "Upload failed" });
      next();
    });
  },
  setAvatarFromUpload
);

// Alias for your current frontend call
router.post(
  "/me/photo",
  requireAuth,
  requireRole("volunteer"),
  (req, res, next) => {
    const handler = uploadAvatar.single("avatar");
    handler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const code = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(code).json({
          message:
            err.code === "LIMIT_FILE_SIZE"
              ? `File too large. Max ${MAX_AVATAR_MB}MB`
              : err.message,
        });
      }
      if (err) return res.status(400).json({ message: err.message || "Upload failed" });
      next();
    });
  },
  setAvatarFromUpload
);

router.delete("/me/avatar", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    assertCloudinaryConfig();
    const vol = await Volunteer.findOne({ userId: req.user._id });
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    if (vol.profilePicture?.publicId) {
      try {
        await cloudinary.uploader.destroy(vol.profilePicture.publicId);
      } catch (e) {
        console.warn("Cloudinary destroy failed:", e?.message || e);
      }
    }
    vol.profilePicture = undefined;
    await vol.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /volunteers/me/avatar error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

export default router;
