// src/routes/rtc.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";
import Notification from "../models/Notification.js";

const router = Router();

/**
 * POST /api/rtc/room
 * Body: { target }  // target is userId to invite
 * Returns: { roomId, room }
 *
 * This endpoint creates a short-lived roomId and (optionally) stores/sends a notification.
 */
router.post("/room", requireAuth, async (req, res) => {
  try {
    const caller = req.user._id;
    const target = (req.body.target || "").trim();
    if (!target) return res.status(400).json({ message: "target required" });

    const roomId = uuidv4();
    const room = { roomId, caller: String(caller), target, createdAt: new Date() };

    // Optionally persist room metadata in DB (omitted) and send a notification so the callee sees the invite
    try {
      await Notification.create({
        user: target,
        type: "call_invite",
        payload: { roomId, from: caller, message: "Incoming call" },
      });
    } catch (e) {
      console.warn("rtc: failed to create call invite notification:", e?.message || e);
      // continue even if notification fails
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
    // If you saved room records, fetch them. For now we return a minimal object.
    return res.json({ roomId });
  } catch (err) {
    console.error("GET /api/rtc/room/:roomId failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
