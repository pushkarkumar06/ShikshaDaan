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

const isOID = (v) => {
  try {
    return mongoose.Types.ObjectId.isValid(String(v));
  } catch {
    return false;
  }
};
const toOID = (v) => new mongoose.Types.ObjectId(v);
const sameId = (a, b) => String(a) === String(b);

function getUserFromReq(req) {
  const id = req.user?._id || req.userId || req.user?.id || (req.user ? String(req.user) : undefined);
  const role = req.user?.role || req.userRole || req.role || undefined;
  const name = req.user?.name || req.userName || null;
  return { id, role, name };
}

// safer notify wrapper: only create if userId looks valid, and never throw
async function safeNotify(userId, type, payload = {}) {
  try {
    if (!userId) return;
    // if userId is already an ObjectId, convert to string first
    const uid = String(userId);
    if (!isOID(uid)) {
      // skip invalid ids
      console.warn(`safeNotify: skipping invalid user id=${uid}`);
      return;
    }
    await Notification.create({ user: uid, type, payload });
  } catch (e) {
    console.warn("safeNotify() failed:", e?.message || e);
  }
}

// ---------- create session request (student -> volunteer OR volunteer -> student) ----------
router.post("/request", requireAuth, async (req, res) => {
  try {
    const { target, subject, message = "", date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!["student", "volunteer"].includes(userRole)) {
      return res.status(403).json({ message: "Only students or volunteers can send requests" });
    }
    if (!target || !subject) {
      return res.status(400).json({ message: "target and subject are required" });
    }
    if (!isOID(target)) return res.status(400).json({ message: "Invalid target id" });

    let studentId, volunteerId, notifyUserId;
    if (userRole === "student") {
      studentId = toOID(userId);
      volunteerId = toOID(target);
      notifyUserId = String(volunteerId);
    } else {
      volunteerId = toOID(userId);
      studentId = toOID(target);
      notifyUserId = String(studentId);
    }

    const doc = await SessionRequest.create({
      student: studentId,
      volunteer: volunteerId,
      requestedBy: toOID(userId),
      subject,
      message,
      proposed: date && time ? { date, time } : undefined,
      status: "pending",
    });

    // notify the opposite user (use safeNotify)
    await safeNotify(notifyUserId, "session_request", {
      requestId: doc._id,
      actorId: userId,
      actorName: userName,
      actorRole: userRole,
      subject,
      message,
      proposedDate: date || null,
      proposedTime: time || null,
    });

    const populated = await SessionRequest.findById(doc._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    return res.status(201).json(populated);
  } catch (err) {
    console.error("POST /sessions/request failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- volunteer offers session proactively ----------
router.post("/offer", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const { studentId, subject, message = "", date, time } = req.body;
    const { id: userId, name: userName } = getUserFromReq(req);

    if (!studentId || !subject) return res.status(400).json({ message: "studentId and subject are required" });
    if (!isOID(studentId)) return res.status(400).json({ message: "Invalid studentId" });

    const sessionRequest = new SessionRequest({
      requestedBy: toOID(userId),
      student: toOID(studentId),
      volunteer: toOID(userId),
      subject,
      message,
      proposed: date && time ? { date, time } : undefined,
      status: "pending",
    });

    await sessionRequest.save();

    const populated = await SessionRequest.findById(sessionRequest._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    await safeNotify(String(studentId), "session_request", {
      requestId: populated._id,
      actorId: userId,
      actorName: userName,
      actorRole: "volunteer",
      subject,
      message,
      proposedDate: date || null,
      proposedTime: time || null,
    });

    return res.status(201).json(populated);
  } catch (err) {
    console.error("POST /sessions/offer failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- volunteer or participant accepts (schedules) ----------
router.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduledAt, date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    // defensive: if session request is missing participant links, mark rejected and return
    if (!sr.student || !sr.volunteer) {
      sr.status = "rejected";
      sr.rejectedAt = new Date();
      sr.updatedAt = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      // notify existing other party (if any) using safeNotify
      const otherId = populated.student?._id ? String(populated.student._id) : (populated.volunteer?._id ? String(populated.volunteer._id) : null);
      if (otherId) {
        await safeNotify(otherId, "session_update", {
          requestId: populated._id,
          status: "rejected",
          actorId: userId || null,
          actorName: userName || "System",
          actorRole: "system",
          subject: populated.subject,
          message: "Request invalid and auto-rejected",
        });
      }

      // emit socket event safely
      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "rejected", session: populated };
      if (io) {
        try {
          const studentId = populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
          const volunteerId = populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);
          if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:rejected", payload);
          if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
        } catch (e) {
          console.warn("socket emit failed:", e?.message || e);
        }
      }

      return res.json(populated);
    }

    // Allow both volunteer and student (or admin) to accept
    const isParticipant =
      String(sr.volunteer) === String(userId) ||
      String(sr.student) === String(userId);

    if (!isParticipant && userRole !== "admin") {
      return res.status(403).json({ message: "Only participants (student or volunteer) can accept here" });
    }

    // If scheduledAt given, set Date
    if (scheduledAt) {
      sr.scheduledAt = new Date(scheduledAt);
    } else if (date && time) {
      const [h = 0, m = 0] = (time || "00:00").split(":").map(Number);
      const d = new Date(date);
      d.setHours(h, m, 0, 0);
      sr.scheduledAt = d;
      sr.final = { date, time };
    }

    sr.status = scheduledAt || (date && time) ? "scheduled" : "accepted";
    sr.acceptedAt = new Date();
    sr.updatedAt = new Date();
    sr.sessionRoomId = sr.sessionRoomId || `session-${sr._id}`;

    await sr.save();

    // award badges if scheduled
    if (sr.status === "scheduled") {
      try { await awardBadgesForVolunteer(String(sr.volunteer)); } catch (e) { console.warn("awardBadges failed", e); }
    }

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    // create notifications for other party (safe)
    const otherId = String(populated.student?._id || populated.student) === String(userId)
      ? String(populated.volunteer?._id || populated.volunteer)
      : String(populated.student?._id || populated.student);

    if (otherId && isOID(otherId)) {
      await safeNotify(otherId, "session_update", {
        requestId: populated._id,
        status: populated.status,
        actorId: userId,
        actorName: userName,
        actorRole: userRole,
        subject: populated.subject,
        message: populated.message || "",
        finalDate: populated.final?.date || (populated.scheduledAt ? populated.scheduledAt.toISOString().split("T")[0] : null),
        finalTime: populated.final?.time || null,
        zoomLink: populated.final?.zoomLink || null,
      });
    }

    // emit socket events safely
    const io = req.app.locals.io || req.app.get("io");
    const payload = {
      _id: String(populated._id),
      status: populated.status,
      startAt: populated.scheduledAt ? new Date(populated.scheduledAt).toISOString() : null,
      session: populated,
    };
    if (io) {
      try {
        const studentId = populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
        const volunteerId = populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);
        if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit(populated.status === "scheduled" ? "session:scheduled" : "session:accepted", payload);
        if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit(populated.status === "scheduled" ? "session:scheduled" : "session:accepted", payload);
      } catch (e) {
        console.warn("socket emit failed:", e?.message || e);
      }
    }

    // schedule start if scheduler exists
    if (req.app.get("scheduler")) {
      try { req.app.get("scheduler").scheduleSessionStart(sr); } catch (e) { console.warn("scheduleSessionStart failed", e); }
    }

    return res.json(populated);
  } catch (err) {
    console.error("POST /sessions/:id/accept failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- reject endpoint (defensive) ----------
router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "" } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    // normalize participant ids to strings (safe if missing)
    const studentIdStr = sr.student ? String(sr.student) : null;
    const volunteerIdStr = sr.volunteer ? String(sr.volunteer) : null;

    // allow participant (student or volunteer) to reject, or admin
    if (userRole !== "admin" && String(userId) !== studentIdStr && String(userId) !== volunteerIdStr) {
      return res.status(403).json({ message: "Not allowed to reject this request" });
    }

    sr.status = "rejected";
    sr.rejectedAt = new Date();
    sr.updatedAt = new Date();
    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    // determine the other party safely and notify if valid
    const otherId = (String(userId) === String(populated.student?._id || populated.student || ''))
      ? String(populated.volunteer?._id || populated.volunteer || '')
      : String(populated.student?._id || populated.student || '');

    if (otherId && isOID(otherId)) {
      try {
        await safeNotify(otherId, "session_update", {
          requestId: populated._id,
          status: "rejected",
          actorId: userId,
          actorName: userName,
          actorRole: userRole,
          subject: populated.subject,
          message: reason || populated.message || "",
        });
      } catch (e) {
        console.warn("notify other party failed:", e?.message || e);
      }
    }

    // emit socket event safely
    const io = req.app.locals.io || req.app.get("io");
    const payload = { _id: String(populated._id), status: "rejected", session: populated };
    if (io) {
      try {
        const studentId = populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
        const volunteerId = populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);
        if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      } catch (e) {
        console.warn("socket emit failed:", e?.message || e);
      }
    }

    return res.json(populated);
  } catch (err) {
    console.error("POST /sessions/:id/reject failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- generic status updater (kept for compatibility) ----------
router.put("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    const allowed = ["accepted", "rejected", "scheduled", "completed", "cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });

    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    // defensive: if session request is missing participant links, mark rejected and return
    if (!sr.student || !sr.volunteer) {
      sr.status = "rejected";
      sr.rejectedAt = new Date();
      sr.updatedAt = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      const otherId = populated.student?._id ? String(populated.student._id) : (populated.volunteer?._id ? String(populated.volunteer._id) : null);
      if (otherId && isOID(otherId)) {
        await safeNotify(otherId, "session_update", {
          requestId: populated._id,
          status: "rejected",
          actorId: userId || null,
          actorName: userName || "System",
          actorRole: "system",
          subject: populated.subject,
          message: "Request invalid and auto-rejected",
        });
      }

      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "rejected", session: populated };
      if (io) {
        try {
          const studentId = String(populated.student?._id || populated.student || '');
          const volunteerId = String(populated.volunteer?._id || populated.volunteer || '');
          if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:rejected", payload);
          if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
        } catch (e) {
          console.warn("socket emit failed:", e?.message || e);
        }
      }

      return res.json(populated);
    }

    if (!sameId(sr.student, userId) && !sameId(sr.volunteer, userId) && userRole !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }

    sr.status = status;
    if (status === "scheduled" && date && time) {
      const [h = 0, m = 0] = (time || "00:00").split(":").map(Number);
      const d = new Date(date);
      d.setHours(h, m, 0, 0);
      sr.scheduledAt = d;
      sr.final = { date, time };
    }
    if (status === "completed") sr.completedAt = new Date();
    if (status === "rejected") sr.rejectedAt = new Date();

    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    const io = req.app.locals.io || req.app.get("io");
    const payload = {
      _id: String(populated._id),
      status: populated.status,
      startAt: populated.scheduledAt ? new Date(populated.scheduledAt).toISOString() : null,
      session: populated,
    };
    if (io) {
      try {
        const studentId = populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
        const volunteerId = populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);
        if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit(`session:${status}`, payload);
        if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit(`session:${status}`, payload);
      } catch (e) {
        console.warn("socket emit failed:", e?.message || e);
      }
    }

    return res.json(populated);
  } catch (err) {
    console.error("PUT /sessions/:id/status failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- student or volunteer respond (accept/reject) ----------
router.post("/:id/respond", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'accepted' | 'rejected'
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });
    if (!["accepted", "rejected"].includes(action)) return res.status(400).json({ message: "Invalid action" });

    const sr = await SessionRequest.findById(id).populate("student", "_id name role").populate("volunteer", "_id name role");
    if (!sr) return res.status(404).json({ message: "Session not found" });

    // defensive: if session request is missing participant links, mark rejected and return
    if (!sr.student || !sr.volunteer) {
      sr.status = "rejected";
      sr.rejectedAt = new Date();
      sr.updatedAt = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      const otherId = populated.student?._id ? String(populated.student._id) : (populated.volunteer?._id ? String(populated.volunteer._id) : null);
      if (otherId && isOID(otherId)) {
        await safeNotify(otherId, "session_update", {
          requestId: populated._id,
          status: "rejected",
          actorId: userId || null,
          actorName: userName || "System",
          actorRole: "system",
          subject: populated.subject,
          message: "Request invalid and auto-rejected",
        });
      }

      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "rejected", session: populated };
      if (io) {
        try {
          const studentId = populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
          const volunteerId = populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);
          if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:rejected", payload);
          if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
        } catch (e) {
          console.warn("socket emit failed:", e?.message || e);
        }
      }

      return res.json(populated);
    }

    const studentId = String(sr.student?._id || sr.student);
    const volunteerId = String(sr.volunteer?._id || sr.volunteer);

    // allow either participant (student OR volunteer) or admin to respond
    if (String(userId) !== studentId && String(userId) !== volunteerId && userRole !== "admin") {
      return res.status(403).json({ message: "Not authorized to respond to this request" });
    }

    if (action === "rejected") {
      sr.status = "rejected";
      sr.rejectedAt = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      // notify the other party (the one who did not perform the action)
      const otherId = String(userId) === studentId ? volunteerId : studentId;
      if (otherId && isOID(otherId)) {
        await safeNotify(otherId, "session_update", {
          requestId: populated._id,
          status: "rejected",
          actorId: userId,
          actorName: userName,
          actorRole: userRole || (String(userId) === studentId ? "student" : "volunteer"),
          subject: populated.subject,
          message: populated.message || "",
        });
      }

      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "rejected", session: populated };
      if (io) {
        try {
          if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:rejected", payload);
          if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
        } catch (e) {
          console.warn("socket emit failed:", e?.message || e);
        }
      }

      return res.json(populated);
    }

    // action === 'accepted'
    // If there is a proposed slot, check availability and attempt to schedule; otherwise mark accepted.
    if (sr.proposed?.date && sr.proposed?.time) {
      const vol = await Volunteer.findOne({ userId: volunteerId });
      let slotTaken = false;
      if (vol) {
        slotTaken = await SessionRequest.exists({
          "final.date": sr.proposed.date,
          "final.time": sr.proposed.time,
          volunteer: volunteerId,
          status: { $in: ["scheduled", "in-progress"] },
          _id: { $ne: sr._id },
        });
      }

      if (slotTaken) {
        sr.status = "accepted";
        await sr.save();

        const populated = await SessionRequest.findById(sr._id)
          .populate("student", "_id name role")
          .populate("volunteer", "_id name role")
          .populate("requestedBy", "_id name role")
          .lean();

        // ask volunteer to reschedule (safe)
        await safeNotify(volunteerId, "session_reschedule_request", {
          sessionId: sr._id,
          session: populated,
          studentId,
          studentName: populated.student?.name || "Student",
          proposedDate: sr.proposed.date,
          proposedTime: sr.proposed.time,
          message: "Requested time slot is no longer available. Please propose a new time.",
        });

        return res.json({ message: "Accepted but needs rescheduling", needsReschedule: true, sessionRequest: populated });
      } else {
        // schedule
        sr.status = "scheduled";
        sr.final = { date: sr.proposed.date, time: sr.proposed.time, zoomLink: sr.proposed.zoomLink || null };

        // set scheduledAt
        const [h = 0, m = 0] = (sr.proposed.time || "00:00").split(":").map(Number);
        const startAt = new Date(sr.proposed.date);
        startAt.setHours(h, m, 0, 0);
        sr.scheduledAt = startAt;
        sr.acceptedAt = new Date();

        // reserve slot in volunteer availability if possible
        if (vol) {
          const day = (vol.availability || []).find((a) => a.date === sr.proposed.date);
          if (day && Array.isArray(day.slots)) {
            day.slots = day.slots.filter((s) => s !== sr.proposed.time);
            await vol.save();
          }
        }

        await sr.save();

        const populated = await SessionRequest.findById(sr._id)
          .populate("student", "_id name role")
          .populate("volunteer", "_id name role")
          .populate("requestedBy", "_id name role")
          .lean();

        // notify the other party (safe)
        const notifyTo = String(userId) === studentId ? volunteerId : studentId;
        if (notifyTo && isOID(notifyTo)) {
          await safeNotify(notifyTo, "session_update", {
            requestId: populated._id,
            status: populated.status,
            actorId: userId,
            actorName: userName,
            actorRole: userRole || (String(userId) === studentId ? "student" : "volunteer"),
            subject: populated.subject,
            finalDate: populated.final?.date || null,
            finalTime: populated.final?.time || null,
            zoomLink: populated.final?.zoomLink || null,
          });
        }

        // emit scheduled event (safe)
        const io = req.app.locals.io || req.app.get("io");
        const payload = {
          _id: String(populated._id),
          status: "scheduled",
          startAt: populated.scheduledAt ? new Date(populated.scheduledAt).toISOString() : null,
          session: populated
        };
        if (io) {
          try {
            if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:scheduled", payload);
            if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:scheduled", payload);
          } catch (e) {
            console.warn("socket emit failed:", e?.message || e);
          }
        }

        // schedule start if scheduler exists
        if (req.app.get("scheduler")) {
          try { req.app.get("scheduler").scheduleSessionStart(sr); } catch (e) { console.warn("scheduleSessionStart failed", e); }
        }

        // award badges
        try { await awardBadgesForVolunteer(String(sr.volunteer)); } catch (e) { console.warn("awardBadgesForVolunteer failed", e); }

        return res.json(populated);
      }
    } else {
      // no proposed slot — simply accept
      sr.status = "accepted";
      sr.acceptedAt = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      // notify the other party (safe)
      const notifyTo = String(userId) === studentId ? volunteerId : studentId;
      if (notifyTo && isOID(notifyTo)) {
        await safeNotify(notifyTo, "session_accepted", {
          requestId: populated._id,
          status: "accepted",
          actorId: userId,
          actorName: userName,
          actorRole: userRole || (String(userId) === studentId ? "student" : "volunteer"),
          subject: populated.subject
        });
      }

      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "accepted", session: populated };
      if (io) {
        try {
          if (studentId && isOID(studentId)) io.to(`user:${studentId}`).emit("session:accepted", payload);
          if (volunteerId && isOID(volunteerId)) io.to(`user:${volunteerId}`).emit("session:accepted", payload);
        } catch (e) {
          console.warn("socket emit failed:", e?.message || e);
        }
      }

      return res.json(populated);
    }
  } catch (err) {
    console.error("POST /sessions/:id/respond failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- get my sessions ----------
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const { id: uid } = getUserFromReq(req);
    const requests = await SessionRequest.find({
      $or: [{ requestedBy: uid }, { student: uid }, { volunteer: uid }],
    })
      .populate("requestedBy", "_id name role")
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .sort({ createdAt: -1 })
      .lean();

    res.json(requests);
  } catch (err) {
    console.error("GET /sessions/mine failed:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- feedback ----------
router.post("/:id/feedback", requireAuth, requireRole("student"), async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const { id: userId } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    const sr = await SessionRequest.findOne({ _id: id, student: userId });
    if (!sr) return res.status(404).json({ message: "Session not found" });
    if (sr.status !== "completed") return res.status(400).json({ message: "Feedback allowed only after completion" });

    sr.feedback = { rating, comment };
    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    return res.json(populated);
  } catch (err) {
    console.error("POST /sessions/:id/feedback failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

export default router;
