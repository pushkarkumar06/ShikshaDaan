// src/routes/session.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, requireRole } from "../middleware/auth.js";
import SessionRequest from "../models/SessionRequest.js";
import Notification from "../models/Notification.js";
import { createMeeting } from "../services/zoom.js";
import Volunteer from "../models/volunteer.js";
import { awardBadgesForVolunteer } from "../services/badges.js";
import { cancelSession, acceptSession } from "../controllers/session.controller.js";

const router = Router();

const isOID = (v) => {
  try { return mongoose.Types.ObjectId.isValid(String(v)); } catch { return false; }
};
const toOID = (v) => new mongoose.Types.ObjectId(v);
const sameId = (a, b) => String(a) === String(b);

function getUserFromReq(req) {
  const id   = req.user?._id || req.userId || req.user?.id || (req.user ? String(req.user) : undefined);
  const role = req.user?.role || req.userRole || req.role || undefined;
  const name = req.user?.name || req.userName || null;
  return { id, role, name };
}

/* ----------------- helpers / normalizers ----------------- */

function normalizeSessionForClient(session) {
  if (!session) return null;
  const src = session.toObject ? session.toObject() : session;
  const result = { ...src };
  [
    "scheduledAt", "acceptedAt", "createdAt", "updatedAt",
    "completedAt", "rejectedAt", "startAt", "endAt"
  ].forEach((k) => {
    if (src[k]) result[k] = new Date(src[k]).toISOString();
    else if (k in src) result[k] = null;
  });
  return result;
}

function normSlot(s = "") {
  return String(s).replace(/\s+/g, "").replace(/–|—/g, "-").trim();
}

function buildISOStart(session, { date, time, scheduledAt } = {}) {
  if (scheduledAt) return new Date(scheduledAt).toISOString();

  if (date && time) {
    const clean = time.includes("-") ? time.split("-")[0] : time;
    const [hh = "00", mm = "00"] = clean.split(":");
    const iso = `${date}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00.000Z`;
    const dt = new Date(iso);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  if (session?.scheduledAt) {
    const dt = new Date(session.scheduledAt);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  if (session?.final?.date && session?.final?.time) {
    return buildISOStart({}, { date: session.final.date, time: session.final.time });
  }
  if (session?.proposed?.date && session?.proposed?.time) {
    return buildISOStart({}, { date: session.proposed.date, time: session.proposed.time });
  }
  if (session?.startAt) {
    const dt = new Date(session.startAt);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

function computeEndISO(startISO, durationMin = 30) {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + Math.max(1, durationMin) * 60_000);
  return end.toISOString();
}

async function removeVolunteerSlot(volunteerId, dateStr, timeStr) {
  try {
    if (!volunteerId || !dateStr || !timeStr) return;
    const uid = String(volunteerId);

    let vol = null;
    try { vol = await Volunteer.findOne({ userId: uid }).exec(); } catch {}
    if (!vol && isOID(uid)) {
      try { vol = await Volunteer.findById(uid).exec(); } catch {}
    }
    if (!vol || !Array.isArray(vol.availability)) return;

    const wanted = normSlot(timeStr);
    const day = vol.availability.find((d) => {
      const aDate = typeof d.date === "string"
        ? d.date
        : (d.date ? new Date(d.date).toISOString().split("T")[0] : null);
      return aDate === dateStr;
    });
    if (!day || !Array.isArray(day.slots)) return;

    const before = day.slots.length;
    day.slots = day.slots.filter((s) => {
      if (!s) return false;
      const slot = normSlot(s);
      if (slot === wanted) return false;
      if (slot.startsWith(wanted) || wanted.startsWith(slot)) return false;
      return true;
    });

    if (day.slots.length !== before) await vol.save();
  } catch (err) {
    console.warn("removeVolunteerSlot failed:", err?.message || err);
  }
}

async function safeNotify(userId, type, payload = {}) {
  try {
    if (!userId) return;
    const uid = String(userId);
    if (!isOID(uid)) return;
    await Notification.create({ user: uid, type, payload });
  } catch (e) {
    console.warn("safeNotify() failed:", e?.message || e);
  }
}

/** Append ?uname=<displayName> (Zoom shows this name in the meeting) */
function withUname(url, displayName) {
  const safe = (displayName || "").trim() || "Guest";
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}uname=${encodeURIComponent(safe)}`;
}

/* ----------------- ROUTES ----------------- */

/* create session request */
router.post("/request", requireAuth, async (req, res) => {
  try {
    const { target, subject, message = "", date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!["student", "volunteer"].includes(userRole)) {
      return res.status(403).json({ message: "Only students or volunteers can send requests" });
    }
    if (!target || !subject) return res.status(400).json({ message: "target and subject are required" });
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

    if (date && time) {
      const exists = await SessionRequest.exists({
        "final.date": date,
        "final.time": time,
        volunteer: String(volunteerId),
        status: { $in: ["scheduled", "in-progress"] },
      });
      if (exists) return res.status(400).json({ message: "Selected slot is already booked" });

      const vol = (await Volunteer.findOne({ userId: String(volunteerId) }).exec())
        || (isOID(String(volunteerId)) ? await Volunteer.findById(String(volunteerId)).exec() : null);

      if (vol && Array.isArray(vol.availability)) {
        const day = vol.availability.find((d) => {
          const aDate = typeof d.date === "string" ? d.date : (d.date ? new Date(d.date).toISOString().split("T")[0] : null);
          return aDate === date;
        });
        const ok = day && Array.isArray(day.slots) && day.slots.some((s) => {
          const ns = normSlot(s);
          const nt = normSlot(time);
          return ns === nt || ns.startsWith(nt) || nt.startsWith(ns);
        });
        if (!ok) return res.status(400).json({ message: "Volunteer is not available at the requested slot" });
      }
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

    return res.status(201).json(normalizeSessionForClient(populated));
  } catch (err) {
    console.error("POST /sessions/request failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* volunteer offers session proactively */
router.post("/offer", requireAuth, requireRole("volunteer"), async (req, res) => {
  try {
    const { studentId, subject, message = "", date, time } = req.body;
    const { id: userId, name: userName } = getUserFromReq(req);

    if (!studentId || !subject) return res.status(400).json({ message: "studentId and subject are required" });
    if (!isOID(studentId)) return res.status(400).json({ message: "Invalid studentId" });

    if (date && time) {
      const vol = (await Volunteer.findOne({ userId: String(userId) }).exec())
        || (isOID(String(userId)) ? await Volunteer.findById(String(userId)).exec() : null);

      if (vol && Array.isArray(vol.availability)) {
        const day = vol.availability.find((d) => {
          const aDate = typeof d.date === "string" ? d.date : (d.date ? new Date(d.date).toISOString().split("T")[0] : null);
          return aDate === date;
        });
        const ok = day && Array.isArray(day.slots) && day.slots.some((s) => {
          const ns = normSlot(s);
          const nt = normSlot(time);
          return ns === nt || ns.startsWith(nt) || nt.startsWith(ns);
        });
        if (!ok) return res.status(400).json({ message: "You don't have that slot in your availability" });
      }

      const exists = await SessionRequest.exists({
        "final.date": date,
        "final.time": time,
        volunteer: String(userId),
        status: { $in: ["scheduled", "in-progress"] },
      });
      if (exists) return res.status(400).json({ message: "Slot already booked" });
    }

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
      requestId: sessionRequest._id,
      actorId: userId,
      actorName: userName,
      actorRole: "volunteer",
      subject,
      message,
      proposedDate: date || null,
      proposedTime: time || null,
    });

    return res.status(201).json(normalizeSessionForClient(populated));
  } catch (err) {
    console.error("POST /sessions/offer failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* cancel & accept (controller-based) */
router.post("/:id/cancel", requireAuth, cancelSession);
router.post("/:id/accept", requireAuth, acceptSession);

/* reject */
router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "" } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });
    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    const studentIdStr   = sr.student ? String(sr.student) : null;
    const volunteerIdStr = sr.volunteer ? String(sr.volunteer) : null;

    if (userRole !== "admin" && String(userId) !== studentIdStr && String(userId) !== volunteerIdStr) {
      return res.status(403).json({ message: "Not allowed to reject this request" });
    }

    sr.status     = "rejected";
    sr.rejectedAt = new Date();
    sr.updatedAt  = new Date();
    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    const otherId =
      String(userId) === String(populated.student?._id || populated.student || "")
        ? String(populated.volunteer?._id || populated.volunteer || "")
        : String(populated.student?._id || populated.student || "");

    if (otherId) {
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
        console.warn("notify other party failed", e?.message || e);
      }
    }

    const io = req.app.locals.io || req.app.get("io");
    const normalizedSession = normalizeSessionForClient(populated);
    const payload = {
      _id: String(populated._id),
      status: "rejected",
      startAt: normalizedSession.scheduledAt,
      session: normalizedSession,
    };

    if (io) {
      try {
        const studentId =
          populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
        const volunteerId =
          populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);

        if (studentId) {
          io.to(`user:${studentId}`).emit("session:rejected", payload);
          io.to(`user:${studentId}`).emit("notification:session_update", { session: normalizedSession });
        }
        if (volunteerId) {
          io.to(`user:${volunteerId}`).emit("session:rejected", payload);
          io.to(`user:${volunteerId}`).emit("notification:session_update", { session: normalizedSession });
        }
      } catch (e) {
        console.warn("socket emit failed:", e?.message || e);
      }
    }

    return res.json(normalizeSessionForClient(populated));
  } catch (err) {
    console.error("POST /sessions/:id/reject failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* generic status updater */
router.put("/:id/status", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date, time, durationMinutes } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });
    const allowed = ["accepted", "rejected", "scheduled", "completed", "cancelled", "expired", "in-progress"];
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });

    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    if (!sr.student || !sr.volunteer) {
      sr.status     = "rejected";
      sr.rejectedAt = new Date();
      sr.updatedAt  = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      const otherId =
        populated.student?._id ? String(populated.student._id)
        : (populated.volunteer?._id ? String(populated.volunteer._id) : null);

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

      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "rejected", session: populated };
      if (io) {
        const studentId  = String(populated.student?._id  || populated.student  || "");
        const volunteerId= String(populated.volunteer?._id|| populated.volunteer|| "");
        if (studentId)  io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      }

      return res.json(normalizeSessionForClient(populated));
    }

    if (!sameId(sr.student, userId) && !sameId(sr.volunteer, userId) && userRole !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }

    sr.status = status;

    if (status === "scheduled" && (date || time)) {
      const startISO = buildISOStart(sr, { date, time });
      if (startISO) {
        const dt = new Date(startISO);
        if (!Number.isNaN(dt.getTime())) {
          sr.scheduledAt   = dt;
          sr.final         = sr.final || {};
          sr.final.date    = dt.toISOString().split("T")[0];
          sr.final.time    = dt.toISOString().slice(11, 16);
          sr.final.startISO= dt.toISOString();
          sr.final.durationMinutes =
            (typeof durationMinutes === "number" && durationMinutes > 0)
              ? durationMinutes
              : (sr.final.durationMinutes || 30);
          sr.final.endISO  = computeEndISO(sr.final.startISO, sr.final.durationMinutes);

          try {
            await removeVolunteerSlot(String(sr.volunteer), sr.final.date, sr.final.time);
          } catch (e) {
            console.warn("slot removal (status update) failed:", e?.message || e);
          }
        }
      }
    }

    if (status === "completed") sr.completedAt = new Date();
    if (status === "rejected")  sr.rejectedAt  = new Date();
    if (status === "cancelled") sr.cancelledAt = new Date();
    if (status === "expired")   sr.expiredAt   = new Date();

    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    const io = req.app.locals.io || req.app.get("io");
    const normalizedSession = normalizeSessionForClient(populated);
    const payload = {
      _id: String(populated._id),
      status: populated.status,
      startAt: normalizedSession.scheduledAt,
      session: normalizedSession,
    };

    if (io) {
      try {
        const studentId  = String(populated.student?._id  || populated.student  || "");
        const volunteerId= String(populated.volunteer?._id|| populated.volunteer|| "");
        const eventType  = `session:${status}`;
        if (studentId) {
          io.to(`user:${studentId}`).emit(eventType, payload);
          io.to(`user:${studentId}`).emit("notification:session_update", { session: normalizedSession });
        }
        if (volunteerId) {
          io.to(`user:${volunteerId}`).emit(eventType, payload);
          io.to(`user:${volunteerId}`).emit("notification:session_update", { session: normalizedSession });
        }
      } catch (e) {
        console.warn("socket emit failed:", e?.message || e);
      }
    }

    if (req.app.get("scheduler") && ["scheduled", "accepted"].includes(status)) {
      try { req.app.get("scheduler").scheduleSession(sr); } catch (e) { console.warn("scheduleSession failed", e); }
    }

    return res.json(normalizeSessionForClient(populated));
  } catch (err) {
    console.error("PUT /sessions/:id/status failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* respond (student/volunteer accept or reject) */
router.post("/:id/respond", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });
    if (!["accepted", "rejected"].includes(action)) return res.status(400).json({ message: "Invalid action" });

    let sr = await SessionRequest.findById(id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role");
    if (!sr) return res.status(404).json({ message: "Session not found" });

    if (!sr.student || !sr.volunteer) {
      sr.status     = "rejected";
      sr.rejectedAt = new Date();
      sr.updatedAt  = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      const otherId =
        populated.student?._id ? String(populated.student._id)
        : (populated.volunteer?._id ? String(populated.volunteer._id) : null);

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

      const io = req.app.locals.io || req.app.get("io");
      const payload = { _id: String(populated._id), status: "rejected", session: populated };
      if (io) {
        const studentId  = String(populated.student?._id  || populated.student  || "");
        const volunteerId= String(populated.volunteer?._id|| populated.volunteer|| "");
        if (studentId)  io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      }

      return res.json(normalizeSessionForClient(populated));
    }

    const studentId  = String(sr.student?._id  || sr.student);
    const volunteerId= String(sr.volunteer?._id|| sr.volunteer);

    if (String(userId) !== studentId && String(userId) !== volunteerId && userRole !== "admin") {
      return res.status(403).json({ message: "Not authorized to respond to this request" });
    }

    if (action === "rejected") {
      sr.status     = "rejected";
      sr.rejectedAt = new Date();
      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      const otherId2 = String(userId) === studentId ? volunteerId : studentId;
      if (otherId2) {
        await safeNotify(otherId2, "session_update", {
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
        if (studentId)  io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId)io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      }

      return res.json(normalizeSessionForClient(populated));
    }

    // accepted path
    if (sr.proposed?.date && sr.proposed?.time) {
      const slotTaken = await SessionRequest.exists({
        "final.date": sr.proposed.date,
        "final.time": sr.proposed.time,
        volunteer: volunteerId,
        status: { $in: ["scheduled", "in-progress"] },
        _id: { $ne: sr._id },
      });

      if (slotTaken) {
        sr.status = "accepted";
        await sr.save();

        const populated = await SessionRequest.findById(sr._id)
          .populate("student", "_id name role")
          .populate("volunteer", "_id name role")
          .populate("requestedBy", "_id name role")
          .lean();

        await safeNotify(volunteerId, "session_reschedule_request", {
          sessionId: sr._id,
          session: populated,
          studentId,
          studentName: populated.student?.name || "Student",
          proposedDate: sr.proposed.date,
          proposedTime: sr.proposed.time,
          message: "Requested time slot is no longer available. Please propose a new time.",
        });

        return res.json({
          message: "Accepted but needs rescheduling",
          needsReschedule: true,
          sessionRequest: populated,
        });
      }

      sr.status       = "scheduled";
      sr.final        = sr.final || {};
      sr.final.date   = sr.proposed.date;
      sr.final.time   = sr.proposed.time;
      const startISO  = buildISOStart(sr, { date: sr.proposed.date, time: sr.proposed.time });
      if (startISO) {
        sr.scheduledAt           = new Date(startISO);
        sr.final.startISO        = startISO;
        sr.final.durationMinutes = sr.final.durationMinutes || 30;
        sr.final.endISO          = computeEndISO(sr.final.startISO, sr.final.durationMinutes);
      }
      sr.acceptedAt = new Date();

      if (sr.final?.date && sr.final?.time) {
        try { await removeVolunteerSlot(volunteerId, sr.final.date, sr.final.time); } catch (e) {
          console.warn("removeVolunteerSlot (respond) failed:", e?.message || e);
        }
      }

      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      const notifyTo = String(userId) === studentId ? volunteerId : studentId;
      if (notifyTo) {
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

      const io = req.app.locals.io || req.app.get("io");
      const normalizedSession = normalizeSessionForClient(populated);
      const payload = {
        _id: String(populated._id),
        status: "scheduled",
        startAt: normalizedSession.scheduledAt,
        session: normalizedSession,
      };

      if (io) {
        try {
          const sId = String(populated.student?._id || populated.student || "");
          const vId = String(populated.volunteer?._id || populated.volunteer || "");
          if (sId) {
            io.to(`user:${sId}`).emit("session:scheduled", payload);
            io.to(`user:${sId}`).emit("notification:session_update", { session: normalizedSession });
          }
          if (vId) {
            io.to(`user:${vId}`).emit("session:scheduled", payload);
            io.to(`user:${vId}`).emit("notification:session_update", { session: normalizedSession });
          }
        } catch (e) {
          console.warn("socket emit failed:", e?.message || e);
        }
      }

      if (req.app.get("scheduler")) {
        try { req.app.get("scheduler").scheduleSession(sr); } catch (e) {
          console.warn("scheduleSession failed", e);
        }
      }

      try { await awardBadgesForVolunteer(String(sr.volunteer)); } catch (e) {
        console.warn("awardBadgesForVolunteer failed", e);
      }

      return res.json(normalizeSessionForClient(populated));
    }

    // simple accept (no proposed)
    sr.status     = "accepted";
    sr.acceptedAt = new Date();
    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    const normalizedSession = normalizeSessionForClient(populated);
    const notifyTo = String(userId) === studentId ? volunteerId : studentId;
    if (notifyTo) {
      await safeNotify(notifyTo, "session_accepted", {
        requestId: populated._id,
        status: "accepted",
        startAt: normalizedSession.scheduledAt,
        session: normalizedSession,
        actorId: userId,
        actorName: userName,
        actorRole: userRole || (String(userId) === studentId ? "student" : "volunteer"),
        subject: populated.subject,
      });
    }

    const io = req.app.locals.io || req.app.get("io");
    const payload = {
      _id: String(populated._id),
      status: "accepted",
      startAt: normalizedSession.scheduledAt,
      session: normalizedSession,
    };

    if (io) {
      try {
        const sId = String(populated.student?._id || populated.student || "");
        const vId = String(populated.volunteer?._id || populated.volunteer || "");
        if (sId) {
          io.to(`user:${sId}`).emit("session:accepted", payload);
          io.to(`user:${sId}`).emit("notification:session_update", { session: normalizedSession });
        }
        if (vId) {
          io.to(`user:${vId}`).emit("session:accepted", payload);
          io.to(`user:${vId}`).emit("notification:session_update", { session: normalizedSession });
        }
      } catch (e) {
        console.warn("socket emit failed:", e?.message || e);
      }
    }

    return res.json(normalizeSessionForClient(populated));
  } catch (err) {
    console.error("POST /sessions/:id/respond failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* presence (join/leave) */
router.post("/:id/presence", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "join" | "leave"
    const { id: userId } = getUserFromReq(req);

    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    const isStudent   = String(sr.student)   === String(userId);
    const isVolunteer = String(sr.volunteer) === String(userId);
    if (!isStudent && !isVolunteer) return res.status(403).json({ message: "Not a participant" });

    const side = isStudent ? "student" : "volunteer";
    const now  = new Date();

    if (action === "join") {
      sr.attendance = sr.attendance || {};
      sr.attendance[side] = sr.attendance[side] || {};
      sr.attendance[side].joinedAt = now;
      if (sr.status === "scheduled") sr.status = "in-progress";
    } else if (action === "leave") {
      sr.attendance = sr.attendance || {};
      sr.attendance[side] = sr.attendance[side] || {};
      sr.attendance[side].leftAt = now;

      const bothLeft = !!sr.attendance.student?.leftAt && !!sr.attendance.volunteer?.leftAt;
      if (bothLeft && !["completed", "cancelled", "expired"].includes(sr.status)) {
        sr.status = "completed";
      }
    } else {
      return res.status(400).json({ message: "Invalid action" });
    }

    await sr.save();

    const io = req.app.get("io");
    if (io) {
      const payload = { _id: String(sr._id), status: sr.status, attendance: sr.attendance };
      io.to(`user:${sr.student}`).to(`user:${sr.volunteer}`).emit("session:presence", payload);
    }

    res.json({ ok: true, session: sr });
  } catch (e) {
    console.error("presence error", e);
    res.status(500).json({ message: "Server error" });
  }
});

/* expire manually when no one joined */
router.post("/:id/expire", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    const noOneJoined = !sr.attendance?.student?.joinedAt && !sr.attendance?.volunteer?.joinedAt;
    if (!noOneJoined) return res.status(400).json({ message: "Someone joined — not expiring" });

    if (["scheduled", "accepted"].includes(sr.status)) {
      sr.status = "expired";
      await sr.save();

      const io = req.app.get("io");
      if (io) {
        const payload = { _id: String(sr._id), status: "expired" };
        io.to(`user:${sr.student}`).to(`user:${sr.volunteer}`).emit("session:expired", payload);
      }
    }

    res.json({ ok: true, status: sr.status });
  } catch (e) {
    console.error("expire error", e);
    res.status(500).json({ message: "Server error" });
  }
});

/* join (generate/return; uses real Zoom) */
/* join (generate/return; uses real Zoom with safe fallback) */
router.get("/:id/join", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    // include email so we can host with volunteer's Zoom email
    let sr = await SessionRequest.findById(id)
      .populate("student",   "_id name role email")
      .populate("volunteer", "_id name role email");
    if (!sr) return res.status(404).json({ message: "Session not found" });

    const isParticipant =
      String(sr.student?._id || sr.student)   === String(userId) ||
      String(sr.volunteer?._id || sr.volunteer) === String(userId);
    if (!isParticipant && userRole !== "admin") {
      return res.status(403).json({ message: "Not allowed" });
    }

    // Work out session start
    const startISO =
      sr.final?.startISO ||
      (sr.scheduledAt ? new Date(sr.scheduledAt).toISOString() : null) ||
      (sr.final?.date && sr.final?.time ? buildISOStart(sr, { date: sr.final.date, time: sr.final.time }) : null);

    // If it's accepted and we have a final slot, auto-promote to scheduled
    const hasFinalSlot = !!(sr.final?.date && sr.final?.time);
    if (sr.status === "accepted" && hasFinalSlot && startISO) {
      sr.status = "scheduled";
      sr.scheduledAt = new Date(startISO);
      sr.final.startISO = startISO;
      sr.final.durationMinutes = sr.final.durationMinutes || 30;
      sr.final.endISO = computeEndISO(sr.final.startISO, sr.final.durationMinutes);
      await sr.save();
    }

    // Allow joining for scheduled, in-progress, or accepted WITH time
    const joinable = new Set(["scheduled", "in-progress", "accepted"]);
    if (!joinable.has(sr.status) || !startISO) {
      return res.status(400).json({ message: "Session not scheduled" });
    }

    const durationMin = sr.final?.durationMinutes ?? 30;
    const startAt = new Date(startISO);
    const now = new Date();
    const windowOpens  = new Date(startAt.getTime() - 15 * 60 * 1000); // 15 min early
    const windowCloses = new Date(startAt.getTime() + durationMin * 60 * 1000);

    if (now < windowOpens) {
      return res.status(403).json({
        message: "Join window not open yet",
        windowOpens: windowOpens.toISOString(),
        currentTime: now.toISOString(),
      });
    }
    if (now > windowCloses) {
      return res.status(403).json({
        message: "Join window has closed",
        windowClosed: windowCloses.toISOString(),
        currentTime: now.toISOString(),
      });
    }

    const volunteerName = sr.volunteer?.name || "Volunteer";
    const studentName   = sr.student?.name   || "Student";

    // Already have a meeting? Return personalized links
    if (sr.zoomMeeting?.joinUrl) {
      if (!sr.final?.zoomLink) {
        sr.final = sr.final || {};
        sr.final.zoomLink = sr.zoomMeeting.joinUrl;
        await sr.save();
      }
      const baseJoin = sr.zoomMeeting.joinUrl;
      return res.json({
        joinUrl: sr.zoomMeeting.joinUrl,
        startUrl: sr.zoomMeeting.startUrl,
        links: {
          volunteerJoinUrl: withUname(baseJoin, volunteerName),
          studentJoinUrl:   withUname(baseJoin, studentName),
        }
      });
    }

    // ---------- Create Zoom meeting with fallback host ----------
    const volunteerEmail = (sr.volunteer?.email || "").trim();
    const defaultHost    = (process.env.ZOOM_DEFAULT_HOST_EMAIL || "").trim();

    if (!volunteerEmail && !defaultHost) {
      return res.status(400).json({
        message: "Zoom host email not configured",
        hint: "Set ZOOM_DEFAULT_HOST_EMAIL in your backend env, or store volunteer.email.",
      });
    }

    async function tryCreate(hostEmail) {
      return await createMeeting({
        hostEmail,
        topic: `ShikshaDaan: ${sr.subject || "Session"}`,
        start_time: startAt.toISOString(),
        duration: durationMin,
        agenda: `Volunteer: ${sr.volunteer?.name || ""} | Student: ${sr.student?.name || ""}`,
        waitingRoom: true,
        alternativeHosts: [],
      });
    }

    let z = null;
    let usedHost = null;
    try {
      if (volunteerEmail) {
        z = await tryCreate(volunteerEmail);
        usedHost = volunteerEmail;
      } else {
        z = await tryCreate(defaultHost);
        usedHost = defaultHost;
      }
    } catch (e1) {
      // if volunteer email failed (user not found / not on account), fall back to default host
      const msg = String(e1?.message || "");
      const looksLikeUserErr =
        msg.includes("user") || msg.includes("not found") || msg.includes("exist") || msg.includes("300");

      if (volunteerEmail && defaultHost && looksLikeUserErr) {
        try {
          z = await tryCreate(defaultHost);
          usedHost = defaultHost;
        } catch (e2) {
          return res.status(502).json({
            message: "Failed to create Zoom meeting (fallback also failed)",
            error: String(e2?.message || e2),
          });
        }
      } else {
        return res.status(502).json({
          message: "Failed to create Zoom meeting",
          error: String(e1?.message || e1),
        });
      }
    }

    // Save meeting
    sr.zoomMeeting = {
      meetingId: z.meetingId,
      startUrl: z.startUrl,
      joinUrl: z.joinUrl,
      password: z.password,
      hostEmail: usedHost,
      createdAt: new Date(),
    };
    sr.final = sr.final || {};
    sr.final.zoomLink = z.joinUrl;
    sr.final.meetingId = z.meetingId;
    sr.final.linkCreatedAt = new Date();
    sr.final.linkExpiresAt = new Date(startAt.getTime() + durationMin * 60 * 1000);
    sr.final.durationMinutes = durationMin;

    if (sr.status === "accepted") sr.status = "scheduled";
    await sr.save();

    const otherId =
      String(userId) === String(sr.student?._id || sr.student)
        ? String(sr.volunteer?._id || sr.volunteer)
        : String(sr.student?._id || sr.student);

    if (otherId && isOID(otherId)) {
      await safeNotify(otherId, "zoom_link_ready", {
        sessionId: sr._id,
        joinUrl: z.joinUrl,
        startAt: startISO,
        duration: durationMin,
      });
    }

    return res.json({
      joinUrl: z.joinUrl,
      startUrl: z.startUrl,
      links: {
        volunteerJoinUrl: withUname(z.joinUrl, volunteerName),
        studentJoinUrl:   withUname(z.joinUrl, studentName),
      }
    });
  } catch (err) {
    console.error("GET /sessions/:id/join failed:", err);
    return res.status(500).json({ message: "Server error", error: String(err?.message || err) });
  }
});


/* get my sessions */
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

    const normalizedRequests = requests.map(normalizeSessionForClient);
    res.json(normalizedRequests);
  } catch (err) {
    console.error("GET /sessions/mine failed:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* feedback */
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

    try {
      const io = req.app.locals.io || req.app.get("io");
      if (io && populated.volunteer) {
        const volunteerId = String(populated.volunteer._id || populated.volunteer);
        io.to(`user:${volunteerId}`).emit("notification:session_update", {
          session: normalizeSessionForClient(populated),
        });
      }
    } catch (e) {
      console.warn("Failed to send feedback notification:", e);
    }

    return res.json(normalizeSessionForClient(populated));
  } catch (err) {
    console.error("POST /sessions/:id/feedback failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

export default router;
