// src/schedular.js
// simple scheduler - keep lightweight for demo
export default function createScheduler(io) {
  const timers = new Map(); // sessionId -> node timeout

  function _toMs(session) {
    // support possible fields: scheduledAt, startAt, start, start_time, startAtISO
    const candidates = [
      session?.scheduledAt,
      session?.startAt,
      session?.start,
      session?.start_time,
      session?.startAtISO,
    ];
    for (const c of candidates) {
      if (!c) continue;
      const t = typeof c === "number" ? c : Date.parse(c);
      if (!Number.isNaN(t)) return t;
    }
    return null;
  }

  function scheduleSessionStart(session = {}) {
    try {
      const sid = String(session._id || session.id || session.requestId || session.sessionId);
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
          // emit 'session:starting' with helpful payload
          const payload = {
            sessionId: sid,
            startAt: new Date(startMs).toISOString(),
            // pass through any useful metadata if available
            student: session.student ? String(session.student) : session.studentId || null,
            volunteer: session.volunteer ? String(session.volunteer) : session.volunteerId || null,
            roomId: session.sessionRoomId || session.roomId || null,
            final: session.final || null,
            raw: session,
          };

          if (payload.student) io.to(`user:${String(payload.student)}`).emit("session:starting", payload);
          if (payload.volunteer) io.to(`user:${String(payload.volunteer)}`).emit("session:starting", payload);

          // Also emit a room-level event so any participants in a shared room can react
          if (payload.roomId) io.to(String(payload.roomId)).emit("session:starting", payload);

          // Optionally you might want to update DB status to "in_progress" here.
        } catch (e) {
          console.warn("scheduler emit failed", e);
        } finally {
          timers.delete(sid);
        }
      }, delay);

      timers.set(sid, t);
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
