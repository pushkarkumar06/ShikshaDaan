// src/routes/review.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import mongoose from "mongoose";
import Review from "../models/Review.js";
import Volunteer from "../models/volunteer.js";
import Notification from "../models/Notification.js";
import { awardBadgesForVolunteer } from "../services/badges.js";

const router = Router();

/**
 * POST /api/reviews
 * Body: { volunteerId: string (User._id), rating: 1-5, comment?: string }
 * Roles: student/admin (your auth middleware allows any authed user; enforce role here if you want)
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { volunteerId, rating, comment } = req.body;

    if (!volunteerId || !rating) {
      return res.status(400).json({ message: "volunteerId & rating required" });
    }
    if (!mongoose.Types.ObjectId.isValid(volunteerId)) {
      return res.status(400).json({ message: "Invalid volunteerId" });
    }
    const num = Number(rating);
    if (Number.isNaN(num) || num < 1 || num > 5) {
      return res.status(400).json({ message: "rating must be between 1 and 5" });
    }

    // Create review
    const review = await Review.create({
      volunteer: volunteerId,
      author: req.user._id,
      rating: num,
      comment: comment || ""
    });

    // Recalculate aggregate rating for the volunteer profile
    const agg = await Review.aggregate([
      { $match: { volunteer: review.volunteer } },
      { $group: { _id: "$volunteer", avg: { $avg: "$rating" }, cnt: { $sum: 1 } } }
    ]);

    if (agg[0]) {
      await Volunteer.findOneAndUpdate(
        { userId: volunteerId },
        { avgRating: agg[0].avg, ratingsCount: agg[0].cnt },
        { new: true }
      );
    }

    // Notify volunteer
    await Notification.create({
      user: volunteerId,
      type: "review_received",
      payload: { reviewId: review._id }
    });

    // 🔰 Hook: re-evaluate and award badges after rating changes
    await awardBadgesForVolunteer(volunteerId);

    return res.json(review);
  } catch (err) {
    console.error("POST /reviews failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
