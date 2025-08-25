import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import SessionRequest from "../models/SessionRequest.js";
import Notification from "../models/Notification.js";
import { createZoomMeetingStub } from "../services/zoom.js";
import Volunteer from "../models/volunteer.js"; // match your actual filename/case
import { awardBadgesForVolunteer } from "../services/badges.js";
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

// Target accepts/sets final schedule => validates against availability and books the slot
router.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { date, time } = req.body;
    if (!date || !time) {
      return res.status(400).json({ message: "date and time are required" });
    }

    const sr = await SessionRequest.findById(req.params.id);
    if (!sr) return res.status(404).json({ message: "Not found" });

    // Only the request "target" can accept
    if (String(sr.target) !== String(req.user._id)) {
      return res.status(403).json({ message: "Only target can accept" });
    }

    // Validate against volunteer availability
    // NOTE: sr.volunteer stores the volunteer's *userId* in your schema
    const vol = await Volunteer.findOne({ userId: sr.volunteer });
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    // We store availability as [{ date: "YYYY-MM-DD", slots: ["HH:mm-HH:mm", ...] }]
    const day = (vol.availability || []).find(a => a.date === date);
    if (!day || !day.slots.includes(time)) {
      return res.status(400).json({ message: "Selected date/time not available" });
    }

    // Create meeting link (stub)
    const zoomLink = await createZoomMeetingStub({ topic: sr.subject, date, time });

    // Mark scheduled
    sr.status = "scheduled";
    sr.final = { date, time, zoomLink };
    await sr.save();
    // After scheduling, award badges to the volunteer
    await awardBadgesForVolunteer(sr.volunteer);


    // Remove the booked slot from availability to prevent double booking
    day.slots = day.slots.filter(s => s !== time);
    // Optional: remove the day entirely if no slots remain
    // vol.availability = vol.availability.filter(a => a.date !== date || a.slots.length > 0);
    await vol.save();

    // Notify volunteer that it has been accepted
    await Notification.create({
      user: sr.volunteer,
      type: "session_accept",
      payload: { requestId: sr._id }
    });

    return res.json(sr);
  } catch (err) {
    console.error("POST /sessions/:id/accept failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


// Get my requests (as volunteer or target)
router.get("/mine", requireAuth, async (req, res) => {
  const list = await SessionRequest.find({
    $or: [{ volunteer: req.user._id }, { target: req.user._id }]
  }).sort({ createdAt: -1 });
  res.json(list);
});


// NEW: student -> volunteer (pick slot from availability)
router.post("/request-to-volunteer", requireAuth, async (req, res) => {
  try {
    const { volunteerId, subject, message, date, slot } = req.body;

    if (!volunteerId || !date || !slot) {
      return res.status(400).json({ message: "volunteerId, date and slot are required" });
    }

    // Validate availability
    const vol = await Volunteer.findOne({ userId: volunteerId });
    if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

    const day = (vol.availability || []).find(a => a.date === date);
    if (!day || !day.slots.includes(slot)) {
      return res.status(400).json({ message: "Selected slot not available" });
    }

    // Create pending request (volunteer will accept)
    const sr = await SessionRequest.create({
      volunteer: volunteerId,      // the volunteer userId
      target: req.user._id,        // student initiating
      subject,
      message,
      proposed: { date, time: slot } // keep time as slot string
    });

    await Notification.create({
      user: volunteerId,
      type: "session_request",
      payload: { requestId: sr._id }
    });

    return res.json(sr);
  } catch (err) {
    console.error("POST /sessions/request-to-volunteer failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


export default router;
