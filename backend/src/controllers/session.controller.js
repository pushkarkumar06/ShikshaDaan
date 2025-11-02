import SessionRequest from "../models/SessionRequest.js";
import Notification from "../models/Notification.js";

/** -------------------- CANCEL -------------------- **/
export const cancelSession = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = String(req.user.id);

    const sr = await SessionRequest.findById(id)
      .populate("student", "_id name")
      .populate("volunteer", "_id name");

    if (!sr) return res.status(404).json({ message: "Session not found" });

    const studentId = String(sr.student?._id || sr.student);
    const volunteerId = String(sr.volunteer?._id || sr.volunteer);

    // Only a participant can cancel
    if (![studentId, volunteerId].includes(userId)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // Only cancel when it's still actionable
    if (!["accepted", "scheduled"].includes(sr.status)) {
      return res
        .status(400)
        .json({ message: "Only accepted/scheduled can be cancelled" });
    }

    sr.status = "cancelled";
    sr.cancelledBy = userId;
    sr.cancelledAt = new Date();
    await sr.save();

    // Broadcast small payload
    const io = req.app.get("io");
    const payload = { _id: String(sr._id), status: "cancelled" };
    if (io) {
      io.to(`user:${studentId}`).emit("session:cancelled", payload);
      io.to(`user:${volunteerId}`).emit("session:cancelled", payload);
    }

    // Best-effort scheduler cleanup
    try {
      const scheduler = req.app.get("scheduler");
      if (scheduler?.cancel) scheduler.cancel(String(sr._id));
    } catch (e) {
      console.warn("Scheduler cleanup failed:", e?.message || e);
    }

    // Notify both
    const notifPayload = {
      requestId: sr._id,
      subject: sr.subject,
      finalDate: sr.final?.date || sr.date || null,
      finalTime: sr.final?.time || sr.time || null,
      by: userId,
    };

    await Promise.all([
      Notification.create({
        user: studentId,
        type: "session_cancelled",
        payload: notifPayload,
      }),
      Notification.create({
        user: volunteerId,
        type: "session_cancelled",
        payload: notifPayload,
      }),
    ]);

    return res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("cancelSession error:", err);
    return res.status(500).json({ message: "Failed to cancel session" });
  }
};

/** -------------------- ACCEPT -------------------- **/
export const acceptSession = async (req, res) => {
  // Debug: log incoming acceptSession request for immediate troubleshooting
  console.log('[acceptSession]', {
    params: req.params,
    body: req.body,
    user: req.user,
    time: new Date().toISOString()
  });
  try {
    const { id } = req.params;
    const viewerId = String(req.user.id);

    const session = await SessionRequest.findById(id)
      .populate("student", "_id name email")
      .populate("volunteer", "_id name email");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const studentId = String(session.student?._id || session.student);
    const volunteerId = String(session.volunteer?._id || session.volunteer);

    // Only the student or the volunteer can accept
    if (![studentId, volunteerId].includes(viewerId)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // Prefer an exact instant from the client if provided
    const { scheduledAt, final, tzOffsetMin } = req.body;

    let computedScheduled = null;

    if (scheduledAt) {
      const t = new Date(scheduledAt);
      if (Number.isNaN(t.getTime())) {
        return res.status(400).json({ message: "Invalid scheduledAt" });
      }
      computedScheduled = t; // exact moment from client
    } else if (final?.date && final?.time) {
      // Build from local parts using client's timezone offset
      // final.time may be "HH:mm" or "HH:mm-HH:mm" -> take the start
      const [startStr] = String(final.time).split("-").map((s) => s.trim());
      const [Y, M, D] = String(final.date).split("-").map(Number);
      const [hh, mm] = String(startStr).split(":").map(Number);

      if (
        [Y, M, D, hh, mm].some((n) => !Number.isFinite(n)) ||
        hh < 0 ||
        hh > 23 ||
        mm < 0 ||
        mm > 59
      ) {
        return res.status(400).json({ message: "Invalid date/time" });
      }

      // Create a UTC ms for the "local wall clock" instant:
      // Date.UTC constructs a UTC timestamp for Y-M-D hh:mm.
      // To represent the *local* instant that the client saw,
      // we subtract the client's timezone offset (in minutes).
      const asUtcMs = Date.UTC(Y, (M || 1) - 1, D, hh, mm);
      const offsetMin = Number.isFinite(Number(tzOffsetMin))
        ? Number(tzOffsetMin)
        : new Date().getTimezoneOffset(); // fallback to server's view of *its* offset
      computedScheduled = new Date(asUtcMs - offsetMin * 60 * 1000);
    } else {
      return res
        .status(400)
        .json({ message: "Provide scheduledAt or final {date,time}" });
    }

    session.scheduledAt = computedScheduled;
    if (final) {
      session.final = { ...(session.final || {}), ...final };
    }
    session.status = "accepted";
    session.updatedAt = new Date();

    await session.save();

    // Notify the other participant
    const recipientId =
      viewerId === studentId ? volunteerId : studentId;

    await Notification.create({
      user: recipientId,
      type: "session_accepted",
      payload: {
        requestId: session._id,
        subject: session.subject,
        scheduledAt: session.scheduledAt,
        finalDate: session.final?.date,
        finalTime: session.final?.time,
        by: viewerId,
      },
    });

    // Real-time update to both
    const io = req.app.get("io");
    if (io) {
      const serialized = session.toObject ? session.toObject() : session;
      io.to(`user:${studentId}`)
        .to(`user:${volunteerId}`)
        .emit("session:updated", serialized);
    }

    return res.json(session);
  } catch (e) {
    console.error("acceptSession error:", e);
    return res.status(500).json({ message: "Failed to accept session" });
  }
};
