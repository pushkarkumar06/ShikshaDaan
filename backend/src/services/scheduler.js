// src/schedular.js
import SessionRequest from "./models/SessionRequest.js";
import { createZoomMeetingStub, createInternalMeetingLink } from "./services/zoom.js";
import mongoose from "mongoose";

/**
 * lightweight scheduler that:
 * - schedules a timeout to run at session start
 * - when triggered, ensures a meeting link exists (generates one just-in-time)
 * - saves the link into SessionRequest.final.zoomLink (if needed)
 * - emits socket events to users/room with meeting link and payload
 *
 * Usage:
 *   const scheduler = createScheduler(io);
 *   scheduler.scheduleSessionStart(sessionObj);
 */
export default function createScheduler(io) {
  const timers = new Map(); // sessionId -> node timeout

  const _toMs = (session) => {
    const candidates = [
      session?.scheduledAt,
      session?.startAt,
      session?.scheduled_at,
      session?.final?.date && session?.final?.time && `${session.final.date}T${session.final.time}`,
      session?.final?.date,
      session?.createdAt,
    ];
    for (const c of candidates) {
      if (!c) continue;
      try {
        // if it's a Date object or ISO string or number
        const t = typeof c === "number" ? c : (c instanceof Date ? c.getTime() : Date.parse(String(c)));
        if (!Number.isNaN(t)) return t;
      } catch (e) {
        continue;
      }
    }
    return null;
  };

  // small helper: determine final date & time strings for a session doc
  function _finalDateTimeFromSession(session) {
    if (session?.final?.date && session?.final?.time) return { date: session.final.date, time: session.final.time };
    if (session?.scheduledAt) {
      const d = new Date(session.scheduledAt);
      const date = d.toISOString().split("T")[0];
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return { date, time: `${hh}:${mm}` };
    }
    return null;
  }

  async function _ensureMeetingLink(sessionDoc) {
    try {
      // If session.final.zoomLink exists -- check expiry if present (we only have zoomLink in schema).
      // We'll generate a new joinUrl only if there isn't one already.
      if (sessionDoc?.final?.zoomLink) {
        return { joinUrl: sessionDoc.final.zoomLink, generated: false };
      }

      // Compose topic/date/time for stub.
      const fd = _finalDateTimeFromSession(sessionDoc) || {};
      const topic = sessionDoc?.subject || `Session-${String(sessionDoc?._id || "")}`;
      const date = fd.date || null;
      const time = fd.time || null;

      // Try to create a real Zoom meeting (currently stub)
      const zoom = await createZoomMeetingStub({ topic, date, time, durationMinutes: 30 }).catch(() => null);
      if (zoom && zoom.joinUrl) {
        // Save to DB safely (only update final.zoomLink - schema allows zoomLink)
        try {
          const sr = await SessionRequest.findById(sessionDoc._id);
          if (sr) {
            sr.final = sr.final || {};
            sr.final.zoomLink = zoom.joinUrl;
            await sr.save();
          }
        } catch (e) {
          console.warn("scheduler: failed to persist zoomLink to SessionRequest:", e?.message || e);
        }
        return { joinUrl: zoom.joinUrl, meta: zoom, generated: true };
      }

      // Fallback: internal link
      const internal = await createInternalMeetingLink({ sessionId: String(sessionDoc._id) }).catch(() => null);
      if (internal && internal.joinUrl) {
        try {
          const sr = await SessionRequest.findById(sessionDoc._id);
          if (sr) {
            sr.final = sr.final || {};
            sr.final.zoomLink = internal.joinUrl;
            await sr.save();
          }
        } catch (e) {
          console.warn("scheduler: failed to persist internal link to SessionRequest:", e?.message || e);
        }
        return { joinUrl: internal.joinUrl, meta: internal, generated: true };
      }

      return { joinUrl: null, generated: false };
    } catch (err) {
      console.warn("scheduler._ensureMeetingLink failed:", err?.message || err);
      return { joinUrl: null, generated: false };
    }
  }

  function scheduleSessionStart(session = {}) {
    try {
      const sid = String(session._id || session.id || session.requestId || session.sessionId || "");
      if (!sid) {
        console.warn("scheduler: missing session id");
        return;
      }

      const startMs = _toMs(session);
      if (startMs === null) {
        console.warn("scheduler: no recognizable start time for session", sid);
        return;
      }

      const now = Date.now();
      const delay = Math.max(0, startMs - now);

      // clear existing timer if present
      if (timers.has(sid)) {
        clearTimeout(timers.get(sid));
        timers.delete(sid);
      }

      // set timeout
      const t = setTimeout(async () => {
        try {
          // Reload session from DB for latest data
          let sessionDoc = null;
          try {
            if (mongoose.Types.ObjectId.isValid(sid)) sessionDoc = await SessionRequest.findById(sid).lean();
            else sessionDoc = await SessionRequest.findOne({ _id: sid }).lean();
          } catch (e) {
            console.warn("scheduler: failed to load session from DB:", e?.message || e);
          }

          // Build payload base
          const payload = {
            sessionId: sid,
            startAt: new Date(startMs).toISOString(),
            student: sessionDoc?.student ? String(sessionDoc.student) : (session.student ? String(session.student) : null),
            volunteer: sessionDoc?.volunteer ? String(sessionDoc.volunteer) : (session.volunteer ? String(session.volunteer) : null),
            roomId: sessionDoc?.sessionRoomId || session?.sessionRoomId || session.roomId || null,
            final: sessionDoc?.final || session?.final || null,
          };

          // Ensure meeting link exists (generate just-in-time if needed)
          const ensure = await _ensureMeetingLink(sessionDoc || session);

          // If ensure provided a joinUrl, attach to payload
          if (ensure?.joinUrl) {
            payload.meeting = {
              joinUrl: ensure.joinUrl,
              generatedJustNow: Boolean(ensure.generated),
              meta: ensure.meta || null,
            };
          } else if (payload.final?.zoomLink) {
            payload.meeting = { joinUrl: payload.final.zoomLink, generatedJustNow: false };
          }

          // Emit notifications / socket events
          try {
            if (payload.student) io.to(`user:${String(payload.student)}`).emit("session:starting", payload);
            if (payload.volunteer) io.to(`user:${String(payload.volunteer)}`).emit("session:starting", payload);

            // separate event with meeting link so frontend can react specifically
            if (payload.meeting?.joinUrl) {
              if (payload.student) io.to(`user:${String(payload.student)}`).emit("session:meeting_link", payload);
              if (payload.volunteer) io.to(`user:${String(payload.volunteer)}`).emit("session:meeting_link", payload);
            }

            // room-level event
            if (payload.roomId) io.to(String(payload.roomId)).emit("session:starting", payload);
            if (payload.roomId && payload.meeting?.joinUrl) io.to(String(payload.roomId)).emit("session:meeting_link", payload);
          } catch (e) {
            console.warn("scheduler: emit failed", e?.message || e);
          }

          // Optionally update DB state or mark "startedAt" (safe non-strict update)
          // If you'd like to record startedAt, you can uncomment the following:
          /*
          try {
            await SessionRequest.findByIdAndUpdate(sid, { $set: { startedAt: new Date() } }, { new: true }).exec();
          } catch (e) {
            console.warn("scheduler: failed to persist startedAt:", e?.message || e);
          }
          */

        } catch (e) {
          console.warn("scheduler timeout handler failed", e?.message || e);
        } finally {
          timers.delete(sid);
        }
      }, delay);

      timers.set(sid, t);
      // return ms delay for debug
      return { scheduled: true, sessionId: sid, runInMs: delay };
    } catch (e) {
      console.error("scheduleSessionStart fail", e);
    }
  }

  function cancelSession(sessionOrId) {
    const sid = String(
      (typeof sessionOrId === "string" || typeof sessionOrId === "number")
        ? sessionOrId
        : sessionOrId?._id || sessionOrId?.id || sessionOrId?.requestId || ""
    );
    if (!sid) return;
    if (timers.has(sid)) {
      clearTimeout(timers.get(sid));
      timers.delete(sid);
    }
  }

  function clearAll() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  return { scheduleSessionStart, cancelSession, clearAll };
}
