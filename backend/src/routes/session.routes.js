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

const isOID = (v) => mongoose.Types.ObjectId.isValid(v);
const toOID = (v) => new mongoose.Types.ObjectId(v);
const sameId = (a, b) => String(a) === String(b);

function getUserFromReq(req) {
  // fallback-friendly extraction of id, role, name
  const id = req.user?._id || req.userId || req.user?.id || (req.user ? String(req.user) : undefined);
  const role = req.user?.role || req.userRole || req.role || undefined;
  const name = req.user?.name || req.userName || null;
  return { id, role, name };
}

async function notify(userId, type, payload = {}) {
  try {
    await Notification.create({ user: userId, type, payload });
  } catch (e) {
    console.warn("notify() failed:", e?.message || e);
  }
}

/**
 * STUDENT or VOLUNTEER -> create a session request
 * body: { target, subject, message?, date?, time? }
 * - sender student: target = volunteerId
 * - sender volunteer: target = studentId
 */
router.post("/request", requireAuth, async (req, res) => {
  try {
    const { target, subject, message = "", date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!["student", "volunteer"].includes(userRole)) {
      return res
        .status(403)
        .json({ message: "Only students or volunteers can send requests" });
    }
    if (!target || !subject) {
      return res.status(400).json({ message: "target and subject are required" });
    }
    if (!isOID(target)) {
      return res.status(400).json({ message: "Invalid target id" });
    }

    let studentId, volunteerId, notifyUserId;
    if (userRole === "student") {
      studentId = userId;
      volunteerId = toOID(target);
      notifyUserId = volunteerId;
    } else {
      volunteerId = userId;
      studentId = toOID(target);
      notifyUserId = studentId;
    }

    const doc = await SessionRequest.create({
      student: studentId,
      volunteer: volunteerId,
      requestedBy: userId,
      subject,
      message,
      proposed: date && time ? { date, time } : undefined,
      status: "pending",
    });

    await Notification.create({
      user: notifyUserId,                 // ← the other party
      type: "session_request",
      payload: {
        requestId: doc._id,
        actorId: userId,            // who performed the action
        actorName: userName,
        actorRole: userRole,
        subject,
        message,
        proposedDate: date || null,
        proposedTime: time || null
      },
    });

    const populated = await SessionRequest.findById(doc._id)
      .populate("student", "name role")
      .populate("volunteer", "name role")
      .populate("requestedBy", "name role");

    return res.status(201).json(populated);
  } catch (err) {
    console.error("POST /sessions/request failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/**
 * VOLUNTEER -> proactively offer session to a student
 * body: { studentId, subject, message?, date?, time? }
 */
router.post("/offer", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const { studentId, subject, message = "", date, time } = req.body;
    const { id: userId, name: userName } = getUserFromReq(req);

    if (!studentId || !subject) {
      return res.status(400).json({ message: "studentId and subject are required" });
    }
    if (!isOID(studentId)) {
      return res.status(400).json({ message: "Invalid studentId" });
    }

    const doc = await SessionRequest.create({
      requestedBy: userId,
      student: toOID(studentId),
      volunteer: userId,
      subject,
      message,
      proposed: date && time ? { date, time } : undefined,
      status: "pending",
    });

    await Notification.create({
      user: studentId,                    // recipient is the student
      type: "session_request",
      payload: {
        requestId: doc._id,
        actorId: userId,
        actorName: userName,
        actorRole: "volunteer",
        subject,
        message,
        proposedDate: date || null,
        proposedTime: time || null
      },
    });

    const populated = await SessionRequest.findById(doc._id)
      .populate("student", "name role")
      .populate("volunteer", "name role")
      .populate("requestedBy", "name role");

    return res.status(201).json(populated);
  } catch (err) {
    console.error("POST /sessions/offer failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/**
 * ACCEPT / REJECT / SCHEDULE / COMPLETE / CANCEL
 */
router.put("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }
    const allowed = ["accepted", "rejected", "scheduled", "completed", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    // Only a participant can change it
    if (!sameId(sr.student, userId) && !sameId(sr.volunteer, userId)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const actorIsVolunteer = userRole === "volunteer";
    const otherPartyId = sameId(sr.student, userId) ? sr.volunteer : sr.student;

    // ACCEPT / REJECT
    if (status === "accepted" || status === "rejected") {
      if (sr.status !== "pending" && sr.status !== "accepted") {
        return res.status(400).json({ message: `Cannot ${status} from status ${sr.status}` });
      }

      if (status === "rejected") {
        sr.status = "rejected";
      } else {
        // ACCEPTED
        if (
          actorIsVolunteer &&
          sr.proposed?.date &&
          sr.proposed?.time
        ) {
          const vol = await Volunteer.findOne({ userId }); // keeping existing search key
          if (!vol) {
            sr.status = "accepted";
          } else {
            const d = (vol.availability || []).find((a) => a.date === sr.proposed.date);
            if (!d || !d.slots.includes(sr.proposed.time)) {
              sr.status = "accepted";
            } else {
              let zoomLink = null;
              try {
                const zoomRes = await createZoomMeetingStub({
                  topic: sr.subject,
                  date: sr.proposed.date,
                  time: sr.proposed.time,
                });
                zoomLink = zoomRes?.join_url || zoomRes?.joinUrl || zoomRes?.url || zoomRes?.link || null;
              } catch (zErr) {
                console.error("Zoom creation failed (accept auto-schedule):", zErr?.message || zErr);
                zoomLink = null;
              }

              sr.final = { date: sr.proposed.date, time: sr.proposed.time, zoomLink };
              sr.status = "scheduled";

              // remove booked slot
              d.slots = d.slots.filter((s) => s !== sr.proposed.time);
              await vol.save();

              try {
                await awardBadgesForVolunteer(userId);
              } catch (badgeErr) {
                console.warn("awardBadgesForVolunteer failed:", badgeErr?.message || badgeErr);
              }
            }
          }
        } else {
          sr.status = "accepted";
        }
      }

      await sr.save();

      await Notification.create({
        user: otherPartyId,
        type: "session_update",
        payload: {
          requestId: sr._id,
          status: sr.status,
          actorId: userId,
          actorName: userName,
          actorRole: userRole,
          subject: sr.subject,
          message: sr.message || '',
          finalDate: sr.final?.date || null,
          finalTime: sr.final?.time || null,
          zoomLink: sr.final?.zoomLink || null
        }
      });

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "name role")
        .populate("volunteer", "name role")
        .populate("requestedBy", "name role");

      return res.json(populated);
    }

    // SCHEDULE (volunteer only)
    if (status === "scheduled") {
      if (!actorIsVolunteer) {
        return res.status(403).json({ message: "Only volunteer can schedule" });
      }
      if (!date || !time) {
        return res.status(400).json({ message: "date and time required to schedule" });
      }

      const vol = await Volunteer.findOne({ userId });
      if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

      const day = (vol.availability || []).find((a) => a.date === date);
      if (!day || !day.slots.includes(time)) {
        return res.status(400).json({ message: "Selected slot not available" });
      }

      let zoomLink = null;
      try {
        const zoomRes = await createZoomMeetingStub({ topic: sr.subject, date, time });
        zoomLink = zoomRes?.join_url || zoomRes?.joinUrl || zoomRes?.url || zoomRes?.link || null;
      } catch (zErr) {
        console.error("Zoom creation failed (manual schedule):", zErr?.message || zErr);
        zoomLink = null;
      }

      sr.final = { date, time, zoomLink };
      sr.status = "scheduled";

      day.slots = day.slots.filter((s) => s !== time);
      await vol.save();

      try {
        await awardBadgesForVolunteer(userId);
      } catch (badgeErr) {
        console.warn("awardBadgesForVolunteer failed:", badgeErr?.message || badgeErr);
      }
      await sr.save();

      await Notification.create({
        user: sr.student,
        type: "session_update",
        payload: {
          requestId: sr._id,
          status: sr.status,
          actorId: userId,
          actorName: userName,
          actorRole: userRole,
          subject: sr.subject,
          message: sr.message || "",
          proposedDate: sr.proposed?.date || null,
          proposedTime: sr.proposed?.time || null,
          finalDate: sr.final?.date || null,
          finalTime: sr.final?.time || null,
          zoomLink: sr.final?.zoomLink || null
        },
      });

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "name role")
        .populate("volunteer", "name role")
        .populate("requestedBy", "name role");

      return res.json(populated);
    }

    // COMPLETED / CANCELLED
    if (status === "completed" || status === "cancelled") {
      sr.status = status;
      await sr.save();

      await notify(otherPartyId, "session_update", {
        requestId: sr._id,
        status: sr.status,
        by: { id: userId, name: userName, role: userRole },
      });

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "name role")
        .populate("volunteer", "name role")
        .populate("requestedBy", "name role");

      return res.json(populated);
    }

    // fallback
    return res.status(400).json({ message: "Unhandled status" });
  } catch (err) {
    console.error("PUT /sessions/:id/status failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// sessions.routes.js - student respond endpoint (replace the old one)
router.put('/:id/respond', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accepted' | 'rejected'
    const { id: userId, name: userName } = getUserFromReq(req);

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid or missing session id' });
    }
    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    // populate minimal fields so we can compare owner ids and notify correctly
    const sr = await SessionRequest.findById(id).populate('volunteer student requestedBy');
    if (!sr) return res.status(404).json({ message: 'Session not found' });

    // derive canonical student id (handles populated object or raw ObjectId)
    const srStudentId = sr.student && (sr.student._id ? String(sr.student._id) : String(sr.student));
    const srVolunteerId = sr.volunteer && (sr.volunteer._id ? String(sr.volunteer._id) : String(sr.volunteer));

    // Only the student (the receiver) may accept/reject here
    if (!srStudentId || String(userId) !== srStudentId) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (sr.status !== 'pending') {
      return res.status(400).json({ message: 'Request no longer pending' });
    }

    // REJECT flow
    if (action === 'rejected') {
      sr.status = 'rejected';
      sr.rejectedAt = new Date();
      await sr.save();

      await Notification.create({
        user: srVolunteerId,
        type: "session_update",
        payload: {
          requestId: sr._id,
          actorId: userId,
          actorName: userName,
          actorRole: "student",
          action: sr.status,                    // keeps existing field
          status: sr.status,                    // also provide "status" for frontend
          subject: sr.subject,
          message: sr.message || '',
          proposed: sr.proposed || null,
          final: sr.final || null,
          finalDate: sr.final?.date || null,    // convenient top-level fields used by UI
          finalTime: sr.final?.time || null,
          zoomLink: sr.final?.zoomLink || null
        },
      });

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "name role")
        .populate("volunteer", "name role")
        .populate("requestedBy", "name role");

      return res.json(populated);
    }

    // ACCEPT flow
    if (action === 'accepted') {
      // If volunteer proposed a slot, try to reserve it and mark scheduled
      if (sr.proposed?.date && sr.proposed?.time) {
        const vol = await Volunteer.findOne({ userId: srVolunteerId });
        let slotTaken = true;
        if (vol) {
          const day = (vol.availability || []).find(a => a.date === sr.proposed.date);
          if (day && Array.isArray(day.slots) && day.slots.includes(sr.proposed.time)) {
            day.slots = day.slots.filter(s => s !== sr.proposed.time);
            await vol.save();
            slotTaken = false;
          }
        }

        if (!slotTaken) {
          sr.final = { date: sr.proposed.date, time: sr.proposed.time, zoomLink: null };
          sr.status = 'scheduled';
          sr.acceptedAt = new Date();
          try { await awardBadgesForVolunteer(String(srVolunteerId)); } catch (e) { console.warn('awardBadgesForVolunteer failed', e?.message || e); }
        } else {
          // fallback to accepted
          sr.status = 'accepted';
          sr.acceptedAt = new Date();
        }
      } else {
        sr.status = 'accepted';
        sr.acceptedAt = new Date();
      }

      await sr.save();

      await Notification.create({
        user: srVolunteerId,
        type: "session_update",
        payload: {
          requestId: sr._id,
          actorId: userId,
          actorName: userName,
          actorRole: "student",
          action: sr.status,                    // keeps existing field
          status: sr.status,                    // also provide "status" for frontend
          subject: sr.subject,
          message: sr.message || '',
          proposed: sr.proposed || null,
          final: sr.final || null,
          finalDate: sr.final?.date || null,    // convenient top-level fields used by UI
          finalTime: sr.final?.time || null,
          zoomLink: sr.final?.zoomLink || null
        },
      });

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "name role")
        .populate("volunteer", "name role")
        .populate("requestedBy", "name role");

      return res.json(populated);
    }

    return res.status(400).json({ message: 'Unhandled action' });
  } catch (err) {
    console.error('PUT /sessions/:id/respond failed:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});


/**
 * Get all my session requests (as student or volunteer or requester)
 */
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const { id: uid } = getUserFromReq(req);
    const requests = await SessionRequest.find({
      $or: [{ volunteer: uid }, { student: uid }, { requestedBy: uid }],
    })
      .sort({ createdAt: -1 })
      .populate("requestedBy", "name role")
      .populate("volunteer", "name role")
      .populate("student", "name role");

    res.json(requests);
  } catch (err) {
    console.error("GET /sessions/mine failed:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/**
 * Student leaves feedback after completion
 */
router.post("/:id/feedback", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const { id: userId } = getUserFromReq(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }

    const sr = await SessionRequest.findOne({ _id: id, student: userId });
    if (!sr) return res.status(404).json({ message: "Session not found" });
    if (sr.status !== "completed") {
      return res.status(400).json({ message: "Feedback allowed only after completion" });
    }

    sr.feedback = { rating, comment };
    await sr.save();

    return res.json(sr);
  } catch (err) {
    console.error("POST /sessions/:id/feedback failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

export default router;
