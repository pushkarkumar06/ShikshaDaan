import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import User from "../models/user.js";

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

export default router;
