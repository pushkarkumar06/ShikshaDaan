// src/routes/session.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireRole } from "../middleware/auth.js";
import SessionRequest from "../models/SessionRequest.js";
import Notification from "../models/Notification.js";
import { createZoomMeetingStub } from "../services/zoom.js";
import Volunteer from "../models/volunteer.js";
import { awardBadgesForVolunteer } from "../services/badges.js";

const router = Router();

/**
 * STUDENT -> VOLUNTEER
 * Create a session request
 */
router.post("/request", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const { volunteerId, subject, message, date, slot } = req.body;

    if (!volunteerId || !subject) {
      return res.status(400).json({ message: "volunteerId and subject are required" });
    }

    // validate volunteer availability if provided
    if (date && slot) {
      const vol = await Volunteer.findOne({ userId: volunteerId });
      if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

      const day = (vol.availability || []).find((a) => a.date === date);
      if (!day || !day.slots.includes(slot)) {
        return res.status(400).json({ message: "Selected slot not available" });
      }
    }

    const sr = await SessionRequest.create({
      createdBy: req.user._id,
      student: req.user._id,
      volunteer: volunteerId,
      subject,
      message,
      proposed: date && slot ? { date, time: slot } : undefined,
      status: "pending",
    });

    await Notification.create({
      user: volunteerId,
      type: "session_request",
      payload: { requestId: sr._id },
    });

    return res.status(201).json(sr);
  } catch (err) {
    console.error("POST /sessions/request failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * VOLUNTEER -> STUDENT
 * Volunteer offers a session proactively
 */
router.post("/offer", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const { studentId, subject, message, date, time } = req.body;

    if (!studentId || !subject) {
      return res.status(400).json({ message: "studentId and subject are required" });
    }

    const sr = await SessionRequest.create({
      createdBy: req.user._id,
      student: studentId,
      volunteer: req.user._id,
      subject,
      message,
      proposed: date && time ? { date, time } : undefined,
      status: "pending",
    });

    await Notification.create({
      user: studentId,
      type: "session_offer",
      payload: { requestId: sr._id },
    });

    return res.status(201).json(sr);
  } catch (err) {
    console.error("POST /sessions/offer failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * VOLUNTEER updates session status (accept/reject/schedule/complete/cancel)
 */
router.put("/:id/status", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date, time } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }

    if (!["accepted", "rejected", "scheduled", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const sr = await SessionRequest.findOne({ _id: id, volunteer: req.user._id });
    if (!sr) return res.status(404).json({ message: "Session not found" });

    if (status === "scheduled") {
      if (!date || !time) {
        return res.status(400).json({ message: "date and time required to schedule" });
      }

      const vol = await Volunteer.findOne({ userId: req.user._id });
      if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

      const day = (vol.availability || []).find((a) => a.date === date);
      if (!day || !day.slots.includes(time)) {
        return res.status(400).json({ message: "Selected slot not available" });
      }

      const zoomLink = await createZoomMeetingStub({ topic: sr.subject, date, time });
      sr.final = { date, time, zoomLink };
      sr.status = "scheduled";

      // remove booked slot
      day.slots = day.slots.filter((s) => s !== time);
      await vol.save();

      // award badges
      await awardBadgesForVolunteer(req.user._id);
    } else {
      sr.status = status;
    }

    await sr.save();

    await Notification.create({
      user: sr.student,
      type: "session_update",
      payload: { requestId: sr._id, status: sr.status },
    });

    return res.json(sr);
  } catch (err) {
    console.error("PUT /sessions/:id/status failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * Get all my session requests (student or volunteer)
 */
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const filter =
      req.user.role === "student"
        ? { student: req.user._id }
        : req.user.role === "volunteer"
        ? { volunteer: req.user._id }
        : {};

    const sessions = await SessionRequest.find(filter)
      .populate("student", "name email")
      .populate("volunteer", "name email")
      .sort({ createdAt: -1 })
      .lean();

    return res.json(sessions);
  } catch (err) {
    console.error("GET /sessions/mine failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * Student leaves feedback after completion
 */
router.post("/:id/feedback", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }

    const sr = await SessionRequest.findOne({ _id: id, student: req.user._id });
    if (!sr) return res.status(404).json({ message: "Session not found" });

    if (sr.status !== "completed") {
      return res.status(400).json({ message: "Feedback allowed only after completion" });
    }

    sr.feedback = { rating, comment };
    await sr.save();

    return res.json(sr);
  } catch (err) {
    console.error("POST /sessions/:id/feedback failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
