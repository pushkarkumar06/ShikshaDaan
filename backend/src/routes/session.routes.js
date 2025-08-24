import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import SessionRequest from "../models/SessionRequest.js";
import Notification from "../models/Notification.js";
import { createZoomMeetingStub } from "../services/zoom.js";

const router = Router();

// Volunteer sends session request to a student/org
router.post("/request", requireAuth, async (req, res) => {
  const { target, subject, message, date, time } = req.body;
  if (req.user.role !== "volunteer") return res.status(403).json({ message: "Only volunteers can start requests" });

  const sr = await SessionRequest.create({
    volunteer: req.user._id, target, subject, message,
    proposed: { date, time }
  });

  await Notification.create({ user: target, type: "session_request", payload: { requestId: sr._id } });
  res.json(sr);
});

// Target accepts/sets final schedule => generates Zoom link (stub)
router.post("/:id/accept", requireAuth, async (req, res) => {
  const { date, time } = req.body;
  const sr = await SessionRequest.findById(req.params.id);
  if (!sr) return res.status(404).json({ message: "Not found" });
  if (String(sr.target) !== String(req.user._id)) return res.status(403).json({ message: "Only target can accept" });

  const zoomLink = await createZoomMeetingStub({ topic: sr.subject, date, time });
  sr.status = "scheduled";
  sr.final = { date, time, zoomLink };
  await sr.save();

  await Notification.create({ user: sr.volunteer, type: "session_accept", payload: { requestId: sr._id } });
  res.json(sr);
});

// Get my requests (as volunteer or target)
router.get("/mine", requireAuth, async (req, res) => {
  const list = await SessionRequest.find({
    $or: [{ volunteer: req.user._id }, { target: req.user._id }]
  }).sort({ createdAt: -1 });
  res.json(list);
});

export default router;
