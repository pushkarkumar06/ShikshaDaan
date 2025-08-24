import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import Notification from "../models/Notification.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const list = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(list);
});

router.post("/:id/read", requireAuth, async (req, res) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: true });
  res.json({ ok: true });
});

export default router;
