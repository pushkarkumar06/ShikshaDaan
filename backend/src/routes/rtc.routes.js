// src/routes/rtc.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";
import Notification from "../models/Notification.js";
import SessionRequest from "../models/SessionRequest.js";
import { createMeeting, endMeeting } from "../services/zoom.js";

const router = Router();

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
 * Simple lookup for room metadata if you persisted it (here we only return the id)
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
 * Helper: server-side window check (fallback if model method not available)
 * Allows generating a Zoom link from 10 minutes before start until 60 minutes after start.
 */
function withinGenerateWindowFromISO(startISO) {
  if (!startISO) return false;
  const start = new Date(startISO).getTime();
  const now = Date.now();
  return start - now <= 10 * 60 * 1000 && now <= start + 60 * 60 * 1000;
}

/**
 * POST /api/rtc/zoom/meeting
 * Body: { sessionId }
 * Returns: { ok, zoom: { meetingId, startUrl, joinUrl, password, hostEmail, createdAt } }
 *
 * - Only the student or volunteer on the session may call this.
 * - Enforces the T−10m window (also implemented on the client).
 * - Creates the meeting once and reuses it thereafter.
 */
router.post("/zoom/meeting", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const s = await SessionRequest.findById(sessionId)
      .populate("student", "_id name")
      .populate("volunteer", "_id name");

    if (!s) return res.status(404).json({ error: "Session not found" });

    const me = String(req.user._id);
    const parties = [String(s.student?._id), String(s.volunteer?._id)];
    if (!parties.includes(me)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Determine start/end/duration from model
    const startISO = s.final?.startISO;
    const endISO = s.final?.endISO;
    let duration = s.final?.durationMinutes;

    if (!startISO) {
      return res.status(400).json({ error: "Session start time is not set" });
    }

    if (!duration && endISO) {
      duration = Math.max(15, Math.ceil((new Date(endISO) - new Date(startISO)) / 60000));
    }
    if (!duration) duration = 30;

    // Window check: prefer model method if available
    const allowed =
      typeof s.isWithinGenerateWindow === "function"
        ? s.isWithinGenerateWindow()
        : withinGenerateWindowFromISO(startISO);

    if (!allowed) {
      return res.status(400).json({ error: "Link can be generated only within 10 minutes of start" });
    }

    // If already created, return existing
    if (s.zoomMeeting?.meetingId) {
      return res.json({ ok: true, zoom: s.zoomMeeting });
    }

    // Create Zoom meeting
    const hostEmail = process.env.ZOOM_DEFAULT_HOST_EMAIL;
    const topic = `ShikshaDaan: ${s.subject || "Session"}`;
    const agenda = `Volunteer: ${s.volunteer?.name || ""} | Student: ${s.student?.name || ""}`;

    const z = await createMeeting({
      hostEmail,
      topic,
      start_time: new Date(startISO).toISOString(),
      duration,
      agenda,
    });

    s.zoomMeeting = {
      meetingId: z.meetingId,
      startUrl: z.startUrl,
      joinUrl: z.joinUrl,
      password: z.password,
      hostEmail,
      createdAt: new Date(),
    };

    // Maintain your status semantics
    if (s.status === "accepted") s.status = "scheduled";

    // Legacy link mirrors for your existing UI (optional)
    s.final = s.final || {};
    s.final.meetingId = z.meetingId;
    s.final.zoomLink = z.joinUrl;
    s.final.durationMinutes = duration;
    s.final.linkCreatedAt = new Date();
    s.final.linkExpiresAt = new Date(Date.now() + duration * 60000);

    await s.save();

    // Notify both parties that a Zoom link is ready (best-effort)
    try {
      const notifPayload = {
        sessionId: String(s._id),
        joinUrl: z.joinUrl,
        startAt: s.final?.startISO,
        duration,
      };
      await Notification.insertMany([
        {
          user: s.student._id,
          type: "zoom_link_ready",
          payload: { ...notifPayload, role: "student" },
        },
        {
          user: s.volunteer._id,
          type: "zoom_link_ready",
          payload: { ...notifPayload, role: "volunteer" },
        },
      ]);
    } catch (e) {
      console.warn("zoom/meeting: notification failed:", e?.message || e);
    }

    return res.json({ ok: true, zoom: s.zoomMeeting });
  } catch (err) {
    // Log Zoom API errors clearly
    const body = err?.response?.data || err?.message || err;
    console.error("POST /api/rtc/zoom/meeting error:", body);
    return res.status(500).json({ error: "Failed to create/fetch Zoom meeting" });
  }
});

/**
 * POST /api/rtc/zoom/end
 * Body: { sessionId }
 * Ends the Zoom meeting (host/admin action or scheduled auto-end).
 */
router.post("/zoom/end", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const s = await SessionRequest.findById(sessionId);
    if (!s?.zoomMeeting?.meetingId) return res.json({ ok: true });

    try {
      await endMeeting(s.zoomMeeting.meetingId);
    } catch (e) {
      console.warn("zoom/end: endMeeting failed (continuing):", e?.message || e);
    }

    s.status = "completed";
    await s.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/rtc/zoom/end error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rtc/zoom/webhook
 * Zoom Event Subscriptions receiver (optional).
 * Configure in Marketplace app → Feature → Event Subscriptions:
 *  - meeting.started
 *  - meeting.ended
 * Protect using a shared header token.
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

    const s = await SessionRequest.findOne({ "zoomMeeting.meetingId": meetingId });
    if (!s) return res.status(200).send("ok");

    if (event === "meeting.started") {
      s.status = "in-progress";
      await s.save();
    } else if (event === "meeting.ended") {
      s.status = "completed";
      await s.save();
    }
    return res.status(200).send("ok");
  } catch (e) {
    console.error("zoom/webhook error:", e);
    return res.status(200).send("ok"); // Respond 200 so Zoom doesn’t retry aggressively
  }
});

export default router;
