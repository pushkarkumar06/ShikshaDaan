import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import Review from "../models/Review.js";
import Volunteer from "../models/volunteer.js";
import Notification from "../models/Notification.js";

const router = Router();

// Create review for a volunteer (students/admins)
router.post("/", requireAuth, async (req, res) => {
  const { volunteerId, rating, comment } = req.body;
  if (!volunteerId || !rating) return res.status(400).json({ message: "volunteerId & rating required" });

  const r = await Review.create({ volunteer: volunteerId, author: req.user._id, rating, comment });

  // Update aggregate rating
  const agg = await Review.aggregate([
    { $match: { volunteer: r.volunteer } },
    { $group: { _id: "$volunteer", avg: { $avg: "$rating" }, cnt: { $sum: 1 } } }
  ]);
  if (agg[0]) {
    await Volunteer.findOneAndUpdate({ userId: volunteerId }, { avgRating: agg[0].avg, ratingsCount: agg[0].cnt });
  }

  // Notify volunteer
  await Notification.create({ user: volunteerId, type: "review_received", payload: { reviewId: r._id } });

  res.json(r);
});

export default router;
