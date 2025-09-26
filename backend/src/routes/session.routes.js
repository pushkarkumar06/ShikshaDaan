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

// Normalize strings by removing spaces and normalizing dash chars
function normSlot(s = "") {
  return String(s).replace(/\s+/g, "").replace(/–|—/g, "-").trim();
}

// robust: remove a slot from a volunteer's availability (tries userId and _id lookups)
// handles slots stored as "11:30" or "11:30-12:00" (with/without spaces)
async function removeVolunteerSlot(volunteerId, dateStr, timeStr) {
  try {
    if (!volunteerId || !dateStr || !timeStr) return;

    const uid = String(volunteerId);
    let vol = null;

    // try common lookup strategies
    try { vol = await Volunteer.findOne({ userId: uid }).exec(); } catch {}
    if (!vol && isOID(uid)) {
      try { vol = await Volunteer.findById(uid).exec(); } catch {}
    }

    if (!vol) return;
    if (!Array.isArray(vol.availability)) return;

    const wanted = normSlot(timeStr);
    const day = vol.availability.find((d) => {
      const aDate = typeof d.date === "string" ? d.date : (d.date ? new Date(d.date).toISOString().split("T")[0] : null);
      return aDate === dateStr;
    });
    if (!day || !Array.isArray(day.slots)) return;

    const before = day.slots.length;
    day.slots = day.slots.filter((s) => {
      if (!s) return false;
      const slot = normSlot(s);

      // exact match
      if (slot === wanted) return false;
      // containment: either "11:30-12:00" startsWith "11:30" or vice-versa
      if (slot.startsWith(wanted) || wanted.startsWith(slot)) return false;

      return true;
    });

    if (day.slots.length !== before) {
      await vol.save();
      console.log(`Removed slot ${timeStr} on ${dateStr} for volunteer ${volunteerId}`);
    }
  } catch (err) {
    console.warn("removeVolunteerSlot failed:", err?.message || err);
  }
}

// safe notification creator (won't throw)
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

// ---------- create session request (student -> volunteer OR volunteer -> student) ----------
router.post("/request", requireAuth, async (req, res) => {
  try {
    const { target, subject, message = "", date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!["student", "volunteer"].includes(userRole)) return res.status(403).json({ message: "Only students or volunteers can send requests" });
    if (!target || !subject) return res.status(400).json({ message: "target and subject are required" });
    if (!isOID(target)) return res.status(400).json({ message: "Invalid target id" });

    // determine participant ids
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

    // if a proposed slot provided, validate availability & whether already scheduled
    if (date && time) {
      // check if the volunteer already has a scheduled session at that date+time
      const exists = await SessionRequest.exists({
        "final.date": date,
        "final.time": time,
        volunteer: String(volunteerId),
        status: { $in: ["scheduled", "in-progress"] }
      });
      if (exists) return res.status(400).json({ message: "Selected slot is already booked" });

      // check volunteer availability (if volunteer doc exists)
      const vol = await Volunteer.findOne({ userId: String(volunteerId) }).exec() || (isOID(String(volunteerId)) ? await Volunteer.findById(String(volunteerId)).exec() : null);
      if (vol && Array.isArray(vol.availability)) {
        const day = vol.availability.find(d => {
          const aDate = typeof d.date === "string" ? d.date : (d.date ? new Date(d.date).toISOString().split("T")[0] : null);
          return aDate === date;
        });
        if (!day || !Array.isArray(day.slots) || !day.slots.some(s => {
          const ns = normSlot(s);
          const nt = normSlot(time);
          return ns === nt || ns.startsWith(nt) || nt.startsWith(ns);
        })) {
          return res.status(400).json({ message: "Volunteer is not available at the requested slot" });
        }
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

    // if proposed slot provided, ensure volunteer (self) actually has that slot and it's not already booked
    if (date && time) {
      const vol = await Volunteer.findOne({ userId: String(userId) }).exec() || (isOID(String(userId)) ? await Volunteer.findById(String(userId)).exec() : null);
      if (vol && Array.isArray(vol.availability)) {
        const day = vol.availability.find(d => {
          const aDate = typeof d.date === "string" ? d.date : (d.date ? new Date(d.date).toISOString().split("T")[0] : null);
          return aDate === date;
        });
        if (!day || !Array.isArray(day.slots) || !day.slots.some(s => {
          const ns = normSlot(s);
          const nt = normSlot(time);
          return ns === nt || ns.startsWith(nt) || nt.startsWith(ns);
        })) {
          return res.status(400).json({ message: "You don't have that slot in your availability" });
        }
      }

      // also ensure not already booked on DB
      const exists = await SessionRequest.exists({
        "final.date": date,
        "final.time": time,
        volunteer: String(userId),
        status: { $in: ["scheduled", "in-progress"] }
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

// ---------- accept (schedules) ----------
router.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduledAt, date, time } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    let sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    // defensive missing participants
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
        const studentId = String(populated.student?._id || populated.student || '');
        const volunteerId = String(populated.volunteer?._id || populated.volunteer || '');
        if (studentId) io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      }

      return res.json(populated);
    }

    const isParticipant = String(sr.volunteer) === String(userId) || String(sr.student) === String(userId);
    if (!isParticipant && userRole !== "admin") return res.status(403).json({ message: "Only participants can accept" });

    // set scheduledAt and final consistently so removal works
    if (scheduledAt) {
      const dt = new Date(scheduledAt);
      sr.scheduledAt = dt;
      sr.final = {
        date: dt.toISOString().split("T")[0],
        time: dt.toTimeString().slice(0,5),
      };
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

    // remove slot if scheduled
    if (sr.status === "scheduled") {
      try {
        const dateStr = sr.final?.date || (sr.scheduledAt ? sr.scheduledAt.toISOString().split("T")[0] : null);
        const timeStr = sr.final?.time || (sr.scheduledAt ? sr.scheduledAt.toTimeString().slice(0,5) : null);
        if (dateStr && timeStr) await removeVolunteerSlot(String(sr.volunteer), dateStr, timeStr);
      } catch (e) { console.warn("slot removal (accept) failed:", e?.message || e); }
    }

    await sr.save();

    if (sr.status === "scheduled") {
      try { await awardBadgesForVolunteer(String(sr.volunteer)); } catch (e) { console.warn("awardBadges failed", e); }
    }

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    const otherId = String(populated.student?._id || populated.student) === String(userId)
      ? String(populated.volunteer?._id || populated.volunteer)
      : String(populated.student?._id || populated.student);

    if (otherId) {
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
        if (studentId) io.to(`user:${studentId}`).emit(populated.status === "scheduled" ? "session:scheduled" : "session:accepted", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit(populated.status === "scheduled" ? "session:scheduled" : "session:accepted", payload);
      } catch (e) { console.warn("socket emit failed:", e?.message || e); }
    }

    if (req.app.get("scheduler")) {
      try { req.app.get("scheduler").scheduleSessionStart(sr); } catch (e) { console.warn("scheduleSessionStart failed", e); }
    }

    return res.json(populated);
  } catch (err) {
    console.error("POST /sessions/:id/accept failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- reject ----------
router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "" } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });
    const sr = await SessionRequest.findById(id);
    if (!sr) return res.status(404).json({ message: "Session not found" });

    const studentIdStr = sr.student ? String(sr.student) : null;
    const volunteerIdStr = sr.volunteer ? String(sr.volunteer) : null;

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

    const otherId = (String(userId) === String(populated.student?._id || populated.student || ''))
      ? String(populated.volunteer?._id || populated.volunteer || '')
      : String(populated.student?._id || populated.student || '');

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
      } catch (e) { console.warn("notify other party failed", e?.message || e); }
    }

    const io = req.app.locals.io || req.app.get("io");
    const payload = { _id: String(populated._id), status: "rejected", session: populated };
    if (io) {
      try {
        const studentId = populated.student?._id ? String(populated.student._id) : (populated.student ? String(populated.student) : null);
        const volunteerId = populated.volunteer?._id ? String(populated.volunteer._id) : (populated.volunteer ? String(populated.volunteer) : null);
        if (studentId) io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      } catch (e) { console.warn("socket emit failed:", e?.message || e); }
    }

    return res.json(populated);
  } catch (err) {
    console.error("POST /sessions/:id/reject failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- generic status updater ----------
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
        const studentId = String(populated.student?._id || populated.student || '');
        const volunteerId = String(populated.volunteer?._id || populated.volunteer || '');
        if (studentId) io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
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

      try { await removeVolunteerSlot(String(sr.volunteer), date, time); } catch (e) { console.warn("slot removal (status update) failed:", e?.message || e); }
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
        if (studentId) io.to(`user:${studentId}`).emit(`session:${status}`, payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit(`session:${status}`, payload);
      } catch (e) { console.warn("socket emit failed:", e?.message || e); }
    }

    return res.json(populated);
  } catch (err) {
    console.error("PUT /sessions/:id/status failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- respond (student/volunteer accept or reject) ----------
router.post("/:id/respond", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const { id: userId, role: userRole, name: userName } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });
    if (!["accepted", "rejected"].includes(action)) return res.status(400).json({ message: "Invalid action" });

    let sr = await SessionRequest.findById(id).populate("student", "_id name role").populate("volunteer", "_id name role");
    if (!sr) return res.status(404).json({ message: "Session not found" });

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
        const studentId = String(populated.student?._id || populated.student || '');
        const volunteerId = String(populated.volunteer?._id || populated.volunteer || '');
        if (studentId) io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      }

      return res.json(populated);
    }

    const studentId = String(sr.student?._id || sr.student);
    const volunteerId = String(sr.volunteer?._id || sr.volunteer);

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

      const otherId = String(userId) === studentId ? volunteerId : studentId;
      if (otherId) {
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
        if (studentId) io.to(`user:${studentId}`).emit("session:rejected", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:rejected", payload);
      }

      return res.json(populated);
    }

    // accepted path
    // If the request had a proposed slot, we attempt to schedule it (create zoom link & remove availability)
    if (sr.proposed?.date && sr.proposed?.time) {
      // check again if slot was taken meanwhile
      const slotTaken = await SessionRequest.exists({
        "final.date": sr.proposed.date,
        "final.time": sr.proposed.time,
        volunteer: volunteerId,
        status: { $in: ["scheduled", "in-progress"] },
        _id: { $ne: sr._id },
      });

      if (slotTaken) {
        sr.status = "accepted"; // accepted but not scheduled
        await sr.save();

        const populated = await SessionRequest.findById(sr._id)
          .populate("student", "_id name role")
          .populate("volunteer", "_id name role")
          .populate("requestedBy", "_id name role")
          .lean();

        // notify volunteer to reschedule
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
      }

      // create Zoom meeting (stub or real)
      let zoomInfo = null;
      try {
        const z = await createZoomMeetingStub({
          topic: sr.subject,
          date: sr.proposed.date,
          time: sr.proposed.time,
          durationMinutes: 30,
        });
        // createZoomMeetingStub may return string or object. Normalize:
        if (!z) zoomInfo = null;
        else if (typeof z === "string") zoomInfo = { joinUrl: z };
        else zoomInfo = z;
      } catch (e) {
        console.warn("createZoomMeetingStub failed:", e?.message || e);
      }

      // schedule the session
      sr.status = "scheduled";
      sr.final = sr.final || {};
      sr.final.date = sr.proposed.date;
      sr.final.time = sr.proposed.time;
      if (zoomInfo && zoomInfo.joinUrl) sr.final.zoomLink = zoomInfo.joinUrl;

      // scheduledAt
      const [hh = 0, mm = 0] = (sr.proposed.time || "00:00").split(":").map(Number);
      const startAt = new Date(sr.proposed.date);
      startAt.setHours(hh, mm, 0, 0);
      sr.scheduledAt = startAt;
      sr.acceptedAt = new Date();

      // remove slot from volunteer availability
      try { await removeVolunteerSlot(volunteerId, sr.proposed.date, sr.proposed.time); } catch (e) { console.warn("removeVolunteerSlot (respond) failed:", e?.message || e); }

      await sr.save();

      const populated = await SessionRequest.findById(sr._id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .populate("requestedBy", "_id name role")
        .lean();

      // notify other party
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
      const payload = {
        _id: String(populated._id),
        status: "scheduled",
        startAt: populated.scheduledAt ? new Date(populated.scheduledAt).toISOString() : null,
        session: populated
      };
      if (io) {
        try {
          if (studentId) io.to(`user:${studentId}`).emit("session:scheduled", payload);
          if (volunteerId) io.to(`user:${volunteerId}`).emit("session:scheduled", payload);
        } catch (e) { console.warn("socket emit failed:", e?.message || e); }
      }

      if (req.app.get("scheduler")) {
        try { req.app.get("scheduler").scheduleSessionStart(sr); } catch (e) { console.warn("scheduleSessionStart failed", e); }
      }

      try { await awardBadgesForVolunteer(String(sr.volunteer)); } catch (e) { console.warn("awardBadgesForVolunteer failed", e); }

      return res.json(populated);
    }

    // no proposed slot — simply accept
    sr.status = "accepted";
    sr.acceptedAt = new Date();
    await sr.save();

    const populated = await SessionRequest.findById(sr._id)
      .populate("student", "_id name role")
      .populate("volunteer", "_id name role")
      .populate("requestedBy", "_id name role")
      .lean();

    const notifyTo = String(userId) === studentId ? volunteerId : studentId;
    if (notifyTo) {
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
        if (studentId) io.to(`user:${studentId}`).emit("session:accepted", payload);
        if (volunteerId) io.to(`user:${volunteerId}`).emit("session:accepted", payload);
      } catch (e) { console.warn("socket emit failed:", e?.message || e); }
    }

    return res.json(populated);
  } catch (err) {
    console.error("POST /sessions/:id/respond failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------- join link endpoint (generate/return join link only to participants and only near start time) ----------
router.get("/:id/join", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = getUserFromReq(req);

    if (!isOID(id)) return res.status(400).json({ message: "Invalid session id" });

    let sr = await SessionRequest.findById(id).populate("student", "_id name role").populate("volunteer", "_id name role");
    if (!sr) return res.status(404).json({ message: "Session not found" });

    const isParticipant = String(sr.student?._id || sr.student) === String(userId) || String(sr.volunteer?._id || sr.volunteer) === String(userId);
    if (!isParticipant && userRole !== "admin") return res.status(403).json({ message: "Not allowed" });

    // must be scheduled to join
    if (sr.status !== "scheduled") return res.status(400).json({ message: "Session not scheduled" });

    // determine scheduled time
    let startsAt = null;
    if (sr.scheduledAt) startsAt = new Date(sr.scheduledAt);
    else if (sr.final?.date && sr.final?.time) {
      const [h = 0, m = 0] = (sr.final.time || "00:00").split(":").map(Number);
      const d = new Date(sr.final.date);
      d.setHours(h, m, 0, 0);
      startsAt = d;
    }

    if (!startsAt || Number.isNaN(startsAt.getTime())) return res.status(400).json({ message: "Scheduled time not available" });

    const now = new Date();
    // allow link generation from X minutes before start until start + Y minutes
    const ALLOW_BEFORE_MIN = Number(process.env.MEETING_ALLOW_BEFORE_MIN || 10); // default 10 minutes before
    const ALLOW_AFTER_MIN = Number(process.env.MEETING_ALLOW_AFTER_MIN || 120); // default 2 hours after
    const windowStart = new Date(startsAt.getTime() - ALLOW_BEFORE_MIN * 60000);
    const windowEnd = new Date(startsAt.getTime() + ALLOW_AFTER_MIN * 60000);

    if (now < windowStart) {
      return res.status(403).json({ message: `Join link not yet available. Will be available at ${windowStart.toISOString()}` });
    }
    if (now > windowEnd) {
      return res.status(403).json({ message: "Join link expired" });
    }

    // if zoom link already exists, return it
    if (sr.final && sr.final.zoomLink) {
      return res.json({ joinUrl: sr.final.zoomLink });
    }

    // otherwise create/generate one now (using stub or real service), save it and return
    try {
      const z = await createZoomMeetingStub({
        topic: sr.subject,
        date: sr.final?.date || startsAt.toISOString().split("T")[0],
        time: sr.final?.time || startsAt.toTimeString().slice(0,5),
        durationMinutes: (sr.final && sr.final.durationMinutes) || 30,
      });

      let zoomInfo = null;
      if (!z) zoomInfo = null;
      else if (typeof z === "string") zoomInfo = { joinUrl: z };
      else zoomInfo = z;

      if (!sr.final) sr.final = {};
      if (zoomInfo && zoomInfo.joinUrl) sr.final.zoomLink = zoomInfo.joinUrl;
      // optional metadata fields
      if (zoomInfo?.meetingId) sr.final.meetingId = zoomInfo.meetingId;
      if (zoomInfo?.linkCreatedAt) sr.final.linkCreatedAt = zoomInfo.linkCreatedAt;
      if (zoomInfo?.linkExpiresAt) sr.final.linkExpiresAt = zoomInfo.linkExpiresAt;
      if (zoomInfo?.durationMinutes) sr.final.durationMinutes = zoomInfo.durationMinutes;

      await sr.save();

      const populated = await SessionRequest.findById(id)
        .populate("student", "_id name role")
        .populate("volunteer", "_id name role")
        .lean();

      // notify other participant that join link generated (optional)
      const otherId = String(userId) === String(populated.student?._id || populated.student) ? String(populated.volunteer?._id || populated.volunteer) : String(populated.student?._id || populated.student);
      if (otherId && isOID(otherId)) {
        await safeNotify(otherId, "session_update", {
          requestId: populated._id,
          status: populated.status,
          actorId: userId,
          actorRole: userRole,
          subject: populated.subject,
          finalDate: populated.final?.date || null,
          finalTime: populated.final?.time || null,
          zoomLink: populated.final?.zoomLink || null,
        });
      }

      return res.json({ joinUrl: sr.final.zoomLink || (zoomInfo && zoomInfo.joinUrl) || null });
    } catch (e) {
      console.warn("Failed to create join link:", e?.message || e);
      return res.status(500).json({ message: "Failed to create join link" });
    }
  } catch (err) {
    console.error("GET /sessions/:id/join failed:", err);
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
