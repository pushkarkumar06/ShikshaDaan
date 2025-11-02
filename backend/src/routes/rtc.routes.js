// src/routes/rtc.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";
import Notification from "../models/Notification.js";
import SessionRequest from "../models/SessionRequest.js";
import { createMeeting, endMeeting } from "../services/zoom.js";

const router = Router();

/* --------------------------------- utils ---------------------------------- */

function isParticipant(sr, uid) {
  const s = String(sr.student?._id || sr.student || "");
  const v = String(sr.volunteer?._id || sr.volunteer || "");
  return String(uid) === s || String(uid) === v;
}

function inferStartDate(sr) {
  if (sr.scheduledAt) return new Date(sr.scheduledAt);
  if (sr.final?.startISO) return new Date(sr.final.startISO);
  if (sr.final?.date && sr.final?.time) return new Date(`${sr.final.date}T${sr.final.time}:00Z`);
  if (sr.proposed?.date && sr.proposed?.time) return new Date(`${sr.proposed.date}T${sr.proposed.time}:00Z`);
  return null;
}

// Append ?uname=<name> (or &uname= if query already present)
function withUname(url, displayName) {
  const safe = (displayName || "").trim() || "Guest";
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}uname=${encodeURIComponent(safe)}`;
}

/* ----------------------------------------------------------------------------
 * Legacy: short-lived internal rooms (kept intact)
 * --------------------------------------------------------------------------*/

/**
 * POST /api/rtc/room
 * Body: { target }  // target is userId to invite
 * Returns: { roomId, room }
 */
router.post("/room", requireAuth, async (req, res) => {
  try {
    const caller = req.user._id;
    const target = (req.body.target || "").trim();
    if (!target) return res.status(400).json({ message: "target required" });

    const roomId = uuidv4();
    const room = { roomId, caller: String(caller), target, createdAt: new Date() };

    try {
      await Notification.create({
        user: target,
        type: "call_invite",
        payload: { roomId, from: caller, message: "Incoming call" },
      });
    } catch (e) {
      console.warn("rtc: failed to create call invite notification:", e?.message || e);
    }

    return res.json({ roomId, room });
  } catch (err) {
    console.error("POST /api/rtc/room failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/rtc/room/:roomId
 */
router.get("/room/:roomId", requireAuth, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    return res.json({ roomId });
  } catch (err) {
    console.error("GET /api/rtc/room/:roomId failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------------------------------------------------------
 * Zoom meeting flow
 * --------------------------------------------------------------------------*/

/**
 * POST /api/rtc/zoom/meeting
 * Body: { sessionId }
 *
 * Creates (or returns) a Zoom meeting for the session.
 * - Only the student or the volunteer can call it.
 * - Generation window: from 1 minute before start until the booked slot ends.
 * - Returns:
 *    {
 *      ok: true,
 *      // base links (without uname) for debugging/back-compat:
 *      joinUrl,
 *      startUrl,             // only if caller is host
 *      // personalized links (recommended by FE):
 *      links: {
 *        volunteerJoinUrl,
 *        studentJoinUrl
 *      },
 *      zoom: { ...persisted on session... }
 *    }
 */
router.post("/zoom/meeting", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const sr = await SessionRequest.findById(sessionId)
      .populate("student", "_id name email")
      .populate("volunteer", "_id name email");

    if (!sr) return res.status(404).json({ error: "Session not found" });

    const uid = req.user._id || req.user.id;
    const isUserParticipant = isParticipant(sr, uid);
    if (!isUserParticipant && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed" });
    }

    // accepted/scheduled/in-progress only
    if (!["accepted", "scheduled", "in-progress"].includes(sr.status)) {
      return res.status(400).json({ error: "Session not scheduled" });
    }

    const startAt = inferStartDate(sr);
    if (!startAt || Number.isNaN(startAt.getTime())) {
      return res.status(400).json({ error: "Session time not set" });
    }

    const durationMin =
      (typeof sr.final?.durationMinutes === "number" && sr.final.durationMinutes > 0)
        ? sr.final.durationMinutes
        : 30;

    // Window: from 1 minute before start until slot end
    const openFrom = startAt.getTime() - 60 * 1000;               // 1 minute before
    const closeAt  = startAt.getTime() + durationMin * 60 * 1000; // end of slot
    const now = Date.now();

    if (now < openFrom) return res.status(403).json({ error: "Too early to generate link" });
    if (now > closeAt) return res.status(403).json({ error: "Join window has closed" });

    const isHost = String(sr.volunteer?._id || sr.volunteer) === String(uid);

    // Host should be the volunteer (so they can admit students from waiting room)
    const hostEmail =
      (sr.volunteer?.email || "").trim() ||
      (process.env.ZOOM_DEFAULT_HOST_EMAIL || "").trim();

    // If a meeting already exists, return it (with personalized links)
    if (sr.zoomMeeting?.joinUrl) {
      const baseJoin = sr.zoomMeeting.joinUrl;
      const volunteerName = sr.volunteer?.name || "Volunteer";
      const studentName   = sr.student?.name   || "Student";
      return res.json({
        ok: true,
        joinUrl: baseJoin,
        startUrl: isHost ? sr.zoomMeeting.startUrl : undefined,
        links: {
          volunteerJoinUrl: withUname(baseJoin, volunteerName),
          studentJoinUrl:   withUname(baseJoin, studentName),
        },
        zoom: sr.zoomMeeting,
      });
    }

    // Create new Zoom meeting
    const topic  = `ShikshaDaan: ${sr.subject || "Session"}`;
    const agenda = `Volunteer: ${sr.volunteer?.name || ""} | Student: ${sr.student?.name || ""}`;

    const zoom = await createMeeting({
      hostEmail,
      topic,
      start_time: new Date(startAt).toISOString(),
      duration: durationMin,
      agenda,
      waitingRoom: true,            // waiting room ON ensures host admits students
      alternativeHosts: [],         // you can add additional Zoom emails if needed
    });

    sr.zoomMeeting = {
      meetingId: zoom.meetingId || zoom.id,
      startUrl:  zoom.startUrl  || zoom.start_url,
      joinUrl:   zoom.joinUrl   || zoom.join_url,
      password:  zoom.password,
      hostEmail,
      createdAt: new Date(),
    };

    // Mirror for back-compat with older UI
    sr.final = sr.final || {};
    sr.final.zoomLink        = sr.zoomMeeting.joinUrl;
    sr.final.meetingId       = sr.zoomMeeting.meetingId;
    sr.final.durationMinutes = durationMin;
    sr.final.startISO        = sr.final.startISO || startAt.toISOString();
    sr.final.endISO          = new Date(startAt.getTime() + durationMin * 60000).toISOString();
    sr.final.linkCreatedAt   = new Date();
    sr.final.linkExpiresAt   = new Date(closeAt);

    // Optional: move accepted → scheduled once meeting exists
    if (sr.status === "accepted") sr.status = "scheduled";

    await sr.save();

    // Notify both parties (best-effort)
    try {
      const payload = {
        sessionId: String(sr._id),
        joinUrl: sr.zoomMeeting.joinUrl,
        startAt: sr.final.startISO,
        duration: durationMin,
      };
      await Notification.insertMany([
        { user: sr.student._id,   type: "zoom_link_ready", payload: { ...payload, role: "student" } },
        { user: sr.volunteer._id, type: "zoom_link_ready", payload: { ...payload, role: "volunteer" } },
      ]);
    } catch (e) {
      console.warn("zoom/meeting: notification failed:", e?.message || e);
    }

    const baseJoin = sr.zoomMeeting.joinUrl;
    const volunteerName = sr.volunteer?.name || "Volunteer";
    const studentName   = sr.student?.name   || "Student";

    return res.json({
      ok: true,
      joinUrl: baseJoin,
      startUrl: isHost ? sr.zoomMeeting.startUrl : undefined,
      links: {
        volunteerJoinUrl: withUname(baseJoin, volunteerName),
        studentJoinUrl:   withUname(baseJoin, studentName),
      },
      zoom: sr.zoomMeeting,
    });
  } catch (err) {
    const body = err?.response?.data || err?.message || err;
    console.error("POST /api/rtc/zoom/meeting error:", body);
    return res.status(500).json({ error: "Failed to create/fetch Zoom meeting" });
  }
});

/**
 * POST /api/rtc/zoom/end
 * Body: { sessionId }
 */
router.post("/zoom/end", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const sr = await SessionRequest.findById(sessionId);
    if (!sr?.zoomMeeting?.meetingId) return res.json({ ok: true });

    try {
      await endMeeting(sr.zoomMeeting.meetingId);
    } catch (e) {
      console.warn("zoom/end: endMeeting failed (continuing):", e?.message || e);
    }

    sr.status = "completed";
    await sr.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/rtc/zoom/end error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rtc/zoom/webhook
 * Protect using a shared header token.
 * Subscribed events: meeting.started, meeting.ended
 */
router.post("/zoom/webhook", async (req, res) => {
  try {
    const token = req.headers["zoom-webhook-signature"];
    if (token !== process.env.ZOOM_WEBHOOK_SECRET_TOKEN) {
      return res.status(401).send("invalid signature");
    }

    const event = req.body?.event;
    const meetingId = String(req.body?.payload?.object?.id || "");
    if (!meetingId) return res.status(200).send("ok");

    const sr = await SessionRequest.findOne({ "zoomMeeting.meetingId": meetingId });
    if (!sr) return res.status(200).send("ok");

    if (event === "meeting.started") {
      sr.status = "in-progress";
      await sr.save();
    } else if (event === "meeting.ended") {
      sr.status = "completed";
      await sr.save();
    }
    return res.status(200).send("ok");
  } catch (e) {
    console.error("zoom/webhook error:", e);
    // Always 200 so Zoom doesn't retry too aggressively
    return res.status(200).send("ok");
  }
});

export default router;
