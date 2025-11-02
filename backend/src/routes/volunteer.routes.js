// src/routes/volunteer.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";

import { requireAuth, requireRole } from "../middleware/auth.js";
import Volunteer from "../models/volunteer.js";
import Review from "../models/Review.js";
import User from "../models/user.js"; // <-- added
import cloudinary from "../utils/cloudinary.js";

const router = Router();

/* ======================================
   Helpers
   ====================================== */
const MAX_AVATAR_MB = parseInt(process.env.MAX_AVATAR_MB || "6", 10);
const AVATAR_FOLDER = process.env.CLOUDINARY_AVATAR_FOLDER || "ShikshaDaan/avatars";

function assertCloudinaryConfig() {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    const err = new Error(
      "Cloudinary env missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
    );
    err.statusCode = 500;
    throw err;
  }
}

const toArrayOfStrings = (v) =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x.trim() : String(x || "")).trim()).filter(Boolean)
    : [];

const toNumberOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// location can be string "City, Country" or object { city, state, country, lat, lng }
const parseLocation = (loc) => {
  if (!loc) return undefined;
  if (typeof loc === "string") {
    const s = loc.trim();
    if (!s) return undefined;
    // very light parse: "City, State, Country" / "City, Country"
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) return { city: parts[0] };
    if (parts.length === 2) return { city: parts[0], country: parts[1] };
    return { city: parts[0], state: parts[1], country: parts[2] };
  }
  if (typeof loc === "object") {
    const out = {};
    if (loc.city) out.city = String(loc.city).trim();
    if (loc.state) out.state = String(loc.state).trim();
    if (loc.country) out.country = String(loc.country).trim();
    if (loc.lat != null) out.lat = Number(loc.lat);
    if (loc.lng != null) out.lng = Number(loc.lng);
    return out;
  }
  return undefined;
};

// availability helpers
const SLOT_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const isValidSlot = (s) => SLOT_REGEX.test(s);
const normalizeDate = (d) => (d || "").trim();
const sanitizeAvailability = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((a) => ({
      date: typeof a?.date === "string" ? a.date.trim() : "",
      slots: toArrayOfStrings(a?.slots).filter(isValidSlot),
    }))
    .filter((a) => a.date && a.slots.length);
};

/* ======================================
   Multer (avatar/photo upload – memory)
   Accept **either** field name: avatar OR photo
   ====================================== */
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

// Cloudinary upload from buffer
function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: AVATAR_FOLDER, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

/* ======================================
   List Volunteers (public)
   - returns name + userId + photoUrl for FE cards
   ====================================== */
router.get("/", async (req, res) => {
  try {
    const { subject } = req.query;
    const q = subject ? { subjects: subject } : {};

    const list = await Volunteer.find(q)
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone avatar"
      )
      .limit(30)
      .lean();

    // attach user.name and user.email (safe) for each volunteer if possible
    const userIds = list.map((v) => v.userId).filter(Boolean);
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select("name email").lean()
      : [];
    const userMap = new Map(users.map(u => [String(u._id), u]));

    const shaped = (list || []).map((v) => {
      const u = userMap.get(String(v.userId)) || {};
      return {
        ...v,
        name: u.name || v.name || null,
        email: u.email || null,
        photoUrl: v?.avatar?.url || null,
      };
    });

    return res.json(shaped);
  } catch (err) {
    console.error("GET /volunteers failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ======================================
   Update own profile
   ====================================== */
router.put("/me", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const payload = {};

    if ("education" in req.body) payload.education = String(req.body.education || "").trim();
    if ("experience" in req.body) payload.experience = String(req.body.experience || "").trim();
    if ("bio" in req.body) payload.bio = String(req.body.bio || "").trim();

    if ("subjects" in req.body) payload.subjects = toArrayOfStrings(req.body.subjects);
    if ("languages" in req.body) payload.languages = toArrayOfStrings(req.body.languages);
    if ("specialties" in req.body) payload.specialties = toArrayOfStrings(req.body.specialties);

    if ("hourlyRate" in req.body) {
      const n = toNumberOrNull(req.body.hourlyRate);
      if (n === null || n < 0) {
        return res.status(400).json({ message: "hourlyRate must be a non-negative number" });
      }
      payload.hourlyRate = n;
    }

    if ("timezone" in req.body) payload.timezone = String(req.body.timezone || "").trim();
    if ("location" in req.body) {
      const loc = parseLocation(req.body.location);
      if (loc) payload.location = loc;
      else payload.location = undefined;
    }

    if ("availability" in req.body) payload.availability = sanitizeAvailability(req.body.availability);

    // legacy/manual: allow directly setting a photoUrl (not destroying any previous avatar)
    if ("photoUrl" in req.body) {
      const u = String(req.body.photoUrl || "").trim();
      if (u) payload.avatar = { ...(payload.avatar || {}), url: u };
      else payload.avatar = undefined;
    }

    const updated = await Volunteer.findOneAndUpdate(
      { userId: req.user._id },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    )
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone availability avgRating ratingsCount avatar"
      )
      .lean();

    // add photoUrl for FE
    return res.json({ ...updated, photoUrl: updated?.avatar?.url || null });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    console.error("PUT /volunteers/me failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ======================================
   Get own profile (simple)
   ====================================== */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const profile = await Volunteer.findOne({ userId: req.user._id })
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone availability avgRating ratingsCount avatar"
      )
      .lean();
    if (!profile) return res.json(null);

    // attach name from User
    const u = await User.findById(req.user._id).select("name email").lean();
    return res.json({ ...profile, name: u?.name || null, email: u?.email || null, photoUrl: profile?.avatar?.url || null });
  } catch (err) {
    console.error("GET /volunteers/me failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ======================================
   Get public profile + reviews (by userId)
   ====================================== */
router.get("/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const profile = await Volunteer.findOne({ userId })
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone availability avgRating ratingsCount avatar"
      )
      .lean();

    if (!profile) return res.status(404).json({ message: "Volunteer profile not found" });

    const reviews = await Review.find({ volunteer: userId })
      .populate("author", "name")
      .sort({ createdAt: -1 })
      .lean();

    // attach user.name/email
    const u = await User.findById(userId).select("name email").lean();

    return res.json({
      profile: { ...profile, name: u?.name || null, email: u?.email || null, photoUrl: profile?.avatar?.url || null },
      reviews
    });
  } catch (err) {
    console.error("GET /volunteers/:userId failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ======================================
   Availability
   ====================================== */
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

/* ======================================
   Avatar upload / delete
   - Accepts **avatar** OR **photo** field names
   - Returns photoUrl for FE
   ====================================== */
function avatarMiddleware(req, res, next) {
  // accept either field name: avatar OR photo
  const handler = uploadAvatar.fields([
    { name: "avatar", maxCount: 1 },
    { name: "photo",  maxCount: 1 },
  ]);
  handler(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const code = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(code).json({
        message: err.code === "LIMIT_FILE_SIZE" ? `File too large. Max ${MAX_AVATAR_MB}MB` : err.message,
      });
    }
    if (err) return res.status(400).json({ message: err.message || "Upload failed" });
    next();
  });
}

async function setAvatarFromUpload(req, res) {
  try {
    assertCloudinaryConfig();
    // pick whichever was sent
    const f1 = req.files?.avatar?.[0];
    const f2 = req.files?.photo?.[0];
    const file = f1 || f2;

    if (!file || !file.buffer) {
      return res.status(400).json({ message: "No file uploaded. Use field 'avatar' or 'photo'." });
    }

    let vol = await Volunteer.findOne({ userId: req.user._id });
    if (!vol) vol = await Volunteer.create({ userId: req.user._id });

    // delete old on Cloudinary (non-fatal)
    const oldPublicId = vol?.avatar?.publicId;
    if (oldPublicId) {
      try {
        await cloudinary.uploader.destroy(oldPublicId);
      } catch (e) {
        console.warn("Cloudinary destroy (old avatar) failed:", e?.message || e);
      }
    }

    // upload new
    const result = await uploadBufferToCloudinary(file.buffer);
    vol.avatar = {
      publicId: result.public_id,
      url: result.secure_url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
      folder: result.folder,
    };
    await vol.save();

    const profile = await Volunteer.findById(vol._id)
      .select(
        "userId education experience bio subjects languages hourlyRate specialties location timezone availability avgRating ratingsCount avatar"
      )
      .lean();

    return res.json({
      message: "Avatar updated",
      photoUrl: profile?.avatar?.url || null,
      profile: { ...profile, photoUrl: profile?.avatar?.url || null },
    });
  } catch (err) {
    console.error("Avatar upload error:", err?.message || err);
    return res.status(err.statusCode || 500).json({ message: err.message || "Server error" });
  }
}

// POST /me/avatar  (primary)
router.post("/me/avatar", requireAuth, requireRole("volunteer"), avatarMiddleware, setAvatarFromUpload);

// POST /me/photo   (alias used by your FE)
router.post("/me/photo", requireAuth, requireRole("volunteer"), avatarMiddleware, setAvatarFromUpload);

// DELETE /me/avatar
router.delete("/me/avatar", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    assertCloudinaryConfig();
    const vol = await Volunteer.findOne({ userId: req.user._id });
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    if (vol.avatar?.publicId) {
      try {
        await cloudinary.uploader.destroy(vol.avatar.publicId);
      } catch (e) {
        console.warn("Cloudinary destroy failed:", e?.message || e);
      }
    }
    vol.avatar = undefined;
    await vol.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /volunteers/me/avatar error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
});

export default router;
