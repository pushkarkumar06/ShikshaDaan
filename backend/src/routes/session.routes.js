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

    if (!["student", "volunteer"].includes(req.user.role)) {
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
    if (req.user.role === "student") {
      studentId = req.user._id;
      volunteerId = toOID(target);
      notifyUserId = volunteerId;
    } else {
      volunteerId = req.user._id;
      studentId = toOID(target);
      notifyUserId = studentId;
    }

    const doc = await SessionRequest.create({
      student: studentId,
      volunteer: volunteerId,
      requestedBy: req.user._id,
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
        actorId: req.user._id,            // who performed the action
        actorName: req.user.name,
        actorRole: req.user.role,
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

    if (!studentId || !subject) {
      return res.status(400).json({ message: "studentId and subject are required" });
    }
    if (!isOID(studentId)) {
      return res.status(400).json({ message: "Invalid studentId" });
    }

    const doc = await SessionRequest.create({
      requestedBy: req.user._id,
      student: toOID(studentId),
      volunteer: req.user._id,
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
        actorId: req.user._id,
        actorName: req.user.name,
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
 * - Accept/Reject: allowed to the opposite party of requestedBy (both roles)
 * - Schedule: only volunteer (uses volunteer availability)
 *
 * body:
 *   { status: 'accepted' | 'rejected' | 'scheduled' | 'completed' | 'cancelled', date?, time? }
 *
 * Behaviour:
 * - accepted:
 *     * If there is a proposed date/time AND the acceptor is the volunteer,
 *       we auto-schedule -> final = proposed, remove slot, create zoom, status='scheduled'
 *     * Else just mark 'accepted'.
 * - rejected: status='rejected'
 * - scheduled (volunteer only): requires date & time, checks availability, sets final, removes slot, zoom.
 */
router.put("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date, time } = req.body;

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
    if (!sameId(sr.student, req.user._id) && !sameId(sr.volunteer, req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const actorIsVolunteer = req.user.role === "volunteer";
    const otherPartyId = sameId(sr.student, req.user._id) ? sr.volunteer : sr.student;

    // ACCEPT / REJECT only when pending or accepted (to support re-accept flow)
    if (status === "accepted" || status === "rejected") {
      if (sr.status !== "pending" && sr.status !== "accepted") {
        return res.status(400).json({ message: `Cannot ${status} from status ${sr.status}` });
      }

      if (status === "rejected") {
        sr.status = "rejected";
      } else {
        // ACCEPTED
        // If volunteer is accepting AND there is a proposed time, auto-schedule
        if (
          actorIsVolunteer &&
          sr.proposed?.date &&
          sr.proposed?.time
        ) {
          const vol = await Volunteer.findOne({ userId: req.user._id });
          if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

          const d = (vol.availability || []).find((a) => a.date === sr.proposed.date);
          if (!d || !d.slots.includes(sr.proposed.time)) {
            // If slot was taken, just mark accepted; frontend can re-schedule manually
            sr.status = "accepted";
          } else {
            const zoomLink = await createZoomMeetingStub({
              topic: sr.subject,
              date: sr.proposed.date,
              time: sr.proposed.time,
            });
            sr.final = { date: sr.proposed.date, time: sr.proposed.time, zoomLink };
            sr.status = "scheduled";

            // remove booked slot
            d.slots = d.slots.filter((s) => s !== sr.proposed.time);
            await vol.save();

            await awardBadgesForVolunteer(req.user._id);
          }
        } else {
          sr.status = "accepted";
        }
      }

      await sr.save();
      await notify(otherPartyId, "session_update", {
        requestId: sr._id,
        status: sr.status,
        // 👍 include these so the UI has data to show
        subject: sr.subject,
        message: sr.message || "",
        proposedDate: sr.proposed?.date || null,
        proposedTime: sr.proposed?.time || null,
        finalDate: sr.final?.date || null,
        finalTime: sr.final?.time || null,
        by: { id: req.user._id, name: req.user.name, role: req.user.role },
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

      const vol = await Volunteer.findOne({ userId: req.user._id });
      if (!vol) return res.status(404).json({ message: "Volunteer profile not found" });

      const day = (vol.availability || []).find((a) => a.date === date);
      if (!day || !day.slots.includes(time)) {
        return res.status(400).json({ message: "Selected slot not available" });
      }

      const zoomLink = await createZoomMeetingStub({ topic: sr.subject, date, time });
      sr.final = { date, time, zoomLink };
      sr.status = "scheduled";

      day.slots = day.slots.filter((s) => s !== time);
      await vol.save();

      await awardBadgesForVolunteer(req.user._id);
      await sr.save();

      await Notification.create({
        user: sr.student,                    // ← student gets the update
        type: "session_update",
        payload: {
          requestId: sr._id,
          status: sr.status,
          actorId: req.user._id,             // volunteer who acted
          actorName: req.user.name,
          actorRole: req.user.role,
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
        by: { id: req.user._id, name: req.user.name, role: req.user.role },
      });

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "name role")
        .populate("volunteer", "name role")
        .populate("requestedBy", "name role");

      return res.json(populated);
    }

    // fallback (should never hit)
    return res.status(400).json({ message: "Unhandled status" });
  } catch (err) {
    console.error("PUT /sessions/:id/status failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});


// sessions.routes.js
router.put('/:id/respond', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { action } = req.body // 'accepted' | 'rejected'
    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' })
    }

    const sr = await SessionRequest.findById(id)
    if (!sr) return res.status(404).json({ message: 'Session not found' })
    // only the student (receiver) may use this
    if (String(sr.student) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not allowed' })
    }
    if (sr.status !== 'pending') {
      return res.status(400).json({ message: 'Request no longer pending' })
    }

    sr.status = action
    await sr.save()

    await Notification.create({
      user: sr.volunteer,                           // ← volunteer receives
      type: "session_update",
      payload: {
        requestId: sr._id,
        actorId: req.user._id,
        actorName: req.user.name,
        actorRole: "student",
        action: sr.status,
        subject: sr.subject,
        proposed: sr.proposed || null,
        final: sr.final || null
      },
    });

    res.json(sr)
  } catch (err) {
    console.error('PUT /sessions/:id/respond failed:', err)
    res.status(500).json({ message: 'Server error' })
  }
})



/**
 * Get all my session requests (as student or volunteer or requester)
 */
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const uid = req.user._id;
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
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

export default router;
