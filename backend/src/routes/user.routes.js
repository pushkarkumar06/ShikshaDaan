import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import User from "../models/user.js";
import { awardBadgesForVolunteer, computeVolunteerStats } from "../services/badges.js";

const router = Router();

// Follow
router.post("/:id/follow", requireAuth, async (req, res) => {
  const targetId = req.params.id;
  if (String(targetId) === String(req.user._id)) return res.status(400).json({ message: "Cannot follow yourself" });

  await User.findByIdAndUpdate(req.user._id, { $addToSet: { following: targetId } });
  await User.findByIdAndUpdate(targetId, { $addToSet: { followers: req.user._id } });
  res.json({ ok: true });
});

// Unfollow
router.post("/:id/unfollow", requireAuth, async (req, res) => {
  const targetId = req.params.id;
  await User.findByIdAndUpdate(req.user._id, { $pull: { following: targetId } });
  await User.findByIdAndUpdate(targetId, { $pull: { followers: req.user._id } });
  res.json({ ok: true });
});


// Get my profile (safe) including badges
router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  if (!user) return res.status(404).json({ message: "User not found" });
  delete user.password;
  return res.json(user);
});

// Public: get user's badges (by userId)
router.get("/:id/badges", async (req, res) => {
  const u = await User.findById(req.params.id, { badges: 1, role: 1, name: 1 }).lean();
  if (!u) return res.status(404).json({ message: "User not found" });
  return res.json({ user: { _id: u._id, name: u.name, role: u.role }, badges: u.badges || [] });
});

// Me: recompute badges now (handy for testing)
router.post("/me/recompute-badges", requireAuth, async (req, res) => {
  if (req.user.role !== "volunteer") {
    return res.status(403).json({ message: "Only volunteers can recompute their badges" });
  }
  const badges = await awardBadgesForVolunteer(req.user._id);
  const stats = await computeVolunteerStats(req.user._id);
  return res.json({ badges, stats });
});

// Public stats for a volunteer (nice for profile)
router.get("/:id/stats", async (req, res) => {
  const stats = await computeVolunteerStats(req.params.id);
  return res.json(stats);
});

export default router;
