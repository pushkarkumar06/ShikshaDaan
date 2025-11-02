// src/schedular.js
import SessionRequest from "../models/SessionRequest.js";
import { endMeeting } from "./zoom.js";

/**
 * Lightweight scheduler:
 *  - Schedules a "window open" ping at T-10 minutes to let UI enable "Generate & Join"
 *  - Schedules an auto-end at session end (calls Zoom endMeeting + marks completed)
 *  - Emits socket events to both student and volunteer rooms
 *
 * Usage:
 *   const scheduler = createScheduler(io);
 *   scheduler.scheduleSession(sessionDocOrLeanObj);
 *
 * You can call scheduleSession() whenever a session becomes "accepted"/"scheduled"
 * or when its time changes; it will re-schedule timers.
 */
export default function createScheduler(io) {
  // Map<sessionId, { preTimer?: NodeJS.Timeout, endTimer?: NodeJS.Timeout }>
  const timers = new Map();

  /* ------------------------------ Helpers ------------------------------ */

  function parseStartEnd(session) {
    // Prefer ISO fields (added in updated model)
    let startISO = session?.final?.startISO || null;
    let endISO   = session?.final?.endISO   || null;

    // Fallback: derive from date/time if ISO isn't present
    if ((!startISO || !endISO) && session?.final?.date && session?.final?.time) {
      const { startISO: sISO, endISO: eISO } = deriveISO(
        session.final.date,
        session.final.time,
        session.final.durationMinutes || 30
      );
      startISO = startISO || sISO;
      endISO   = endISO   || eISO;
    }

    const startMs = startISO ? Date.parse(startISO) : null;
    const endMs   = endISO   ? Date.parse(endISO)   : null;

    return { startISO, endISO, startMs, endMs };
  }

  function deriveISO(dateStr, timeStr, durationMinutes = 30) {
    let sh = 0, sm = 0, dur = durationMinutes;
    if (timeStr?.includes("-")) {
      const [s, e] = timeStr.split("-");
      const [h1, m1] = s.split(":").map(Number);
      const [h2, m2] = e.split(":").map(Number);
      sh = h1 || 0; sm = m1 || 0;
      const diff = (h2 * 60 + (m2 || 0)) - (sh * 60 + sm);
      if (diff > 0) dur = diff;
    } else if (timeStr) {
      const [h, m] = timeStr.split(":").map(Number);
      sh = h || 0; sm = m || 0;
    }
    const [Y, M, D] = dateStr.split("-").map(Number);
    const start = new Date(Date.UTC(Y, (M - 1), D, sh, sm, 0));
    const end   = new Date(start.getTime() + dur * 60000);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }

  function emitToUsers(sessionId, studentId, volunteerId, event, payload) {
    try {
      if (studentId)   io.to(`user:${String(studentId)}`).emit(event, payload);
      if (volunteerId) io.to(`user:${String(volunteerId)}`).emit(event, payload);
    } catch (e) {
      console.warn(`scheduler emit failed (${event})`, e?.message || e);
    }
  }

  function clearTimers(sessionId) {
    const t = timers.get(sessionId);
    if (!t) return;
    if (t.preTimer) clearTimeout(t.preTimer);
    if (t.endTimer) clearTimeout(t.endTimer);
    timers.delete(sessionId);
  }

  /* --------------------------- Core scheduling --------------------------- */

  /**
   * Schedules BOTH:
   *  - T-10 minute "window open" ping → event: "session:window_open"
   *  - Auto end at session end → ends Zoom + marks status "completed"
   */
  async function scheduleSession(sessionLike = {}) {
    try {
      const sessionId = String(
        sessionLike?._id || sessionLike?.id || sessionLike?.requestId || sessionLike?.sessionId || ""
      );
      if (!sessionId) {
        console.warn("scheduler: missing session id");
        return { scheduled: false, reason: "no-session-id" };
      }

      // Load the latest from DB to avoid stale times
      let s;
      try {
        s = await SessionRequest.findById(sessionId).lean();
      } catch (e) {
        console.warn("scheduler: failed to load session from DB:", e?.message || e);
        return { scheduled: false, reason: "not-found" };
      }
      if (!s) return { scheduled: false, reason: "not-found" };

      const { startMs, endMs } = parseStartEnd(s);
      if (!startMs || !endMs) {
        console.warn("scheduler: missing start/end for", sessionId);
        return { scheduled: false, reason: "no-time" };
      }

      // Clear any existing timers for this session
      clearTimers(sessionId);

      const now = Date.now();

      // PRE-START: T-10 min window ping (never schedule in the past)
      const preAt = Math.max(0, startMs - 10 * 60 * 1000 - now);
      const preTimer = setTimeout(async () => {
        try {
          // Reload minimal identifiers for emit
          const fresh = await SessionRequest.findById(sessionId, "student volunteer final").lean();
          const payload = {
            sessionId,
            startAt: new Date(startMs).toISOString(),
            windowOpensAt: new Date(Date.now()).toISOString(),
            final: fresh?.final || null,
          };
          emitToUsers(sessionId, fresh?.student, fresh?.volunteer, "session:window_open", payload);
        } catch (e) {
          console.warn("scheduler: preStart handler failed", e?.message || e);
        }
      }, preAt);

      // END: auto-end exactly at endMs (never schedule in the past)
      const endDelay = Math.max(0, endMs - now);
      const endTimer = setTimeout(async () => {
        try {
          // Load full doc to end meeting and update status
          const doc = await SessionRequest.findById(sessionId);
          if (!doc) return;

          // Expiry logic: flip to expired if nobody joined, else completed
          if (["scheduled", "accepted", "in-progress"].includes(doc.status)) {
            const noOneJoined = !doc.attendance?.student?.joinedAt && !doc.attendance?.volunteer?.joinedAt;
            if (noOneJoined) {
              doc.status = "expired";
              await doc.save();
              emitToUsers(sessionId, doc?.student, doc?.volunteer, "session:expired", { _id: String(doc._id), status: "expired" });
              clearTimers(sessionId);
              return;
            } else if (!["completed", "cancelled"].includes(doc.status)) {
              doc.status = "completed";
              await doc.save();
            }
          }

          // Attempt to end Zoom meeting if it exists
          const meetingId = doc?.zoomMeeting?.meetingId;
          if (meetingId) {
            try {
              await endMeeting(meetingId);
            } catch (e) {
              console.warn("scheduler: endMeeting failed (continuing):", e?.message || e);
            }
          }

          // Emit "session:ended" so clients can close UI
          const payload = {
            sessionId,
            endedAt: new Date().toISOString(),
            meetingId: meetingId || null,
          };
          emitToUsers(sessionId, doc?.student, doc?.volunteer, "session:ended", payload);
        } catch (e) {
          console.warn("scheduler: end handler failed", e?.message || e);
        } finally {
          clearTimers(sessionId);
        }
      }, endDelay);

      timers.set(sessionId, { preTimer, endTimer });

      return {
        scheduled: true,
        sessionId,
        preRunsInMs: preAt,
        endRunsInMs: endDelay,
      };
    } catch (e) {
      console.error("scheduleSession fail", e);
      return { scheduled: false, reason: "exception" };
    }
  }

  function cancelSession(sessionOrId) {
    const sessionId = String(
      typeof sessionOrId === "string" || typeof sessionOrId === "number"
        ? sessionOrId
        : sessionOrId?._id || sessionOrId?.id || sessionOrId?.requestId || ""
    );
    if (!sessionId) return { cancelled: false, reason: "no-session-id" };
    clearTimers(sessionId);
    return { cancelled: true, sessionId };
  }

  function clearAll() {
    for (const t of timers.values()) {
      if (t.preTimer) clearTimeout(t.preTimer);
      if (t.endTimer) clearTimeout(t.endTimer);
    }
    timers.clear();
  }

  return {
    scheduleSession,
    cancelSession,
    clearAll,
  };
}

/* ------------------------------- (Optional) ------------------------------- */
/**
 * If you want to also schedule a "session:starting" event exactly at start time,
 * add a third timer like the two above and emit that event. The UI can then auto-switch
 * from countdown → “Join/Start” view when the clock hits zero.
 */
