// src/routes/volunteer.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireRole } from "../middleware/auth.js";
import Volunteer from "../models/volunteer.js";
import Review from "../models/Review.js"; // <-- ensure this matches your actual filename exactly

const router = Router();

/**
 * GET /api/volunteers
 * Optional: ?subject=Math
 */
router.get("/", async (req, res) => {
  try {
    const { subject } = req.query;
    const q = subject ? { subjects: subject } : {};
    const list = await Volunteer.find(q).limit(20).lean();
    return res.json(list);
  } catch (err) {
    console.error("GET /volunteers failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PUT /api/volunteers/me
 * Update own volunteer profile
 */
router.put("/me", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const allowed = ["education", "experience", "bio", "subjects", "languages", "hourlyRate", "availability"];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    const profile = await Volunteer.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { new: true }
    ).lean();

    if (!profile) return res.status(404).json({ message: "Volunteer profile not found" });
    return res.json(profile);
  } catch (err) {
    console.error("PUT /volunteers/me failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/volunteers/:userId
 * Public volunteer profile + reviews
 */
router.get("/:userId", async (req, res) => {
  try {
    const userId = (req.params.userId || "").trim(); // avoid \n / spaces
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const profile = await Volunteer.findOne({ userId }).lean();
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




// slots are strings like "09:00-09:30"
const SLOT_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const isValidSlot = s => SLOT_REGEX.test(s);

const normalizeDate = (d) => (d || "").trim(); // we store YYYY-MM-DD as plain string

/** --- READ availability for a volunteer --- */
/** GET /api/volunteers/:userId/availability?from=YYYY-MM-DD&to=YYYY-MM-DD */
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
      avail = avail.filter(a => {
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

/** --- REPLACE slots for a specific date (volunteer only) --- */
/** PUT /api/volunteers/me/availability
 *  body: { date: "YYYY-MM-DD", slots: ["09:00-09:30", ...] }
 */
router.put("/me/availability", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const date = normalizeDate(req.body.date);
    const slots = Array.isArray(req.body.slots) ? req.body.slots.filter(isValidSlot) : [];

    if (!date) return res.status(400).json({ message: "date required (YYYY-MM-DD)" });

    const vol = await Volunteer.findOne({ userId: req.user._id });
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    // replace the date entry
    let updated = false;
    vol.availability = (vol.availability || []).map(a => {
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

/** --- PATCH single slot add/remove (volunteer only) --- */
/** PATCH /api/volunteers/me/availability
 *  body: { date: "YYYY-MM-DD", slot: "HH:mm-HH:mm", action: "add"|"remove" }
 */
router.patch("/me/availability", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const date = normalizeDate(req.body.date);
    const slot = (req.body.slot || "").trim();
    const action = (req.body.action || "add").trim();

    if (!date || !isValidSlot(slot)) {
      return res.status(400).json({ message: "Invalid date or slot" });
    }

    const vol = await Volunteer.findOne({ userId: req.user._id });
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    vol.availability ||= [];
    let day = vol.availability.find(a => a.date === date);
    if (!day) {
      day = { date, slots: [] };
      vol.availability.push(day);
    }

    if (action === "remove") {
      day.slots = day.slots.filter(s => s !== slot);
    } else {
      if (!day.slots.includes(slot)) day.slots.push(slot);
    }

    await vol.save();
    return res.json(day);
  } catch (err) {
    console.error("PATCH /me/availability failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});





export default router;
