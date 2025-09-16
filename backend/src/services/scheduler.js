// simple scheduler - keep lightweight for demo
export default function createScheduler(io) {
    const timers = new Map(); // sessionId -> node timeout
  
    function scheduleSessionStart(session) {
      try {
        const start = new Date(session.startAt).getTime();
        const now = Date.now();
        const delay = Math.max(0, start - now);
  
        // clear existing
        if (timers.has(String(session._id))) clearTimeout(timers.get(String(session._id)));
  
        const t = setTimeout(async () => {
          // emit to participants
          try {
            io.to(`user:${String(session.student)}`).emit('session:starting', { sessionId: String(session._id) });
            io.to(`user:${String(session.volunteer)}`).emit('session:starting', { sessionId: String(session._id) });
            // optionally update DB status to "in_progress"
          } catch (e) {
            console.warn('scheduler emit failed', e);
          }
        }, delay);
  
        timers.set(String(session._id), t);
      } catch (e) {
        console.error('scheduleSessionStart fail', e);
      }
    }
  
    function cancelSession(sessionId) {
      if (timers.has(String(sessionId))) {
        clearTimeout(timers.get(String(sessionId)));
        timers.delete(String(sessionId));
      }
    }
  
    return { scheduleSessionStart, cancelSession };
  }
  