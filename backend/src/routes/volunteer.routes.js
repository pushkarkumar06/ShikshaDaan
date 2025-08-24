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

export default router;
