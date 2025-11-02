// src/routes/notification.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import Notification from "../models/Notification.js";

const router = Router();

// List MY notifications (newest first)
router.get("/", requireAuth, async (req, res) => {
  const list = await Notification
    .find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .lean();
  res.json(list);
});

// Mark one notification read (only mine)
router.post("/:id/read", requireAuth, async (req, res) => {
  const { id } = req.params;
  await Notification.updateOne({ _id: id, user: req.user._id }, { $set: { read: true } });
  res.json({ ok: true });
});

// Mark all mine as read
router.post("/read-all", requireAuth, async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
  res.json({ ok: true });
});

export default router;