// src/utils/datetime.js

/** ---------- low-level helpers ---------- **/

function _validNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** Build a Date in the *local* timezone for Y-M-D h:m and return its ms. */
function _localPartsToMs(Y, M, D, h = 0, m = 0) {
  const dt = new Date(Y, (M || 1) - 1, D, h, m, 0, 0); // local wall-clock
  const t = dt.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Parse "HH:mm" into [h, m] or null. */
function _parseHHmm(s) {
  const [hStr, mStr] = String(s).split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!_validNum(h) || !_validNum(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return [h, m];
}

/** Split "HH:mm-HH:mm" -> ["HH:mm","HH:mm"]; also accepts a single "HH:mm". */
function _splitTimeOrRange(timeOrRange) {
  const parts = String(timeOrRange).split("-").map(s => s.trim());
  return parts.length === 1 ? [parts[0], null] : [parts[0], parts[1]];
}

/** ---------- primary conversions ---------- **/

/**
 * Convert a local date (YYYY-MM-DD) and time or time-range ("HH:mm" or "HH:mm-HH:mm")
 * to the exact UTC instant for the START of that slot.
 *
 * @returns {{ms:number, iso:string} | null}
 */
export function localDateTimeToIso(dateStr, timeOrRange) {
  if (!dateStr || !timeOrRange) return null;
  try {
    const [Y, M, D] = String(dateStr).split("-").map(Number);
    if (![_validNum(Y), _validNum(M), _validNum(D)].every(Boolean)) return null;

    const [startStr] = _splitTimeOrRange(timeOrRange);
    const startHM = _parseHHmm(startStr);
    if (!startHM) return null;

    const [h, m] = startHM;
    const ms = _localPartsToMs(Y, M, D, h, m);
    if (ms == null) return null;

    return { ms, iso: new Date(ms).toISOString() };
  } catch (err) {
    console.error("localDateTimeToIso error:", err);
    return null;
  }
}

/**
 * Convert a local date (YYYY-MM-DD) and time-range ("HH:mm-HH:mm")
 * to exact UTC instants for both start and end.
 *
 * @returns {{startMs:number,startIso:string,endMs:number,endIso:string} | null}
 */
export function localDateTimeRangeToIso(dateStr, timeRange) {
  if (!dateStr || !timeRange) return null;
  try {
    const [Y, M, D] = String(dateStr).split("-").map(Number);
    if (![_validNum(Y), _validNum(M), _validNum(D)].every(Boolean)) return null;

    const [startStr, endStr] = _splitTimeOrRange(timeRange);
    const startHM = _parseHHmm(startStr);
    const endHM = _parseHHmm(endStr);
    if (!startHM || !endHM) return null;

    const [sh, sm] = startHM;
    const [eh, em] = endHM;

    const startMs = _localPartsToMs(Y, M, D, sh, sm);
    const endMs   = _localPartsToMs(Y, M, D, eh, em);
    if (startMs == null || endMs == null) return null;

    return {
      startMs,
      startIso: new Date(startMs).toISOString(),
      endMs,
      endIso: new Date(endMs).toISOString(),
    };
  } catch (err) {
    console.error("localDateTimeRangeToIso error:", err);
    return null;
  }
}

/**
 * The client’s timezone offset in minutes (e.g. IST = -330).
 * Useful if the server needs to reconstruct an instant from local parts.
 */
export function getClientTzOffsetMinutes() {
  return new Date().getTimezoneOffset();
}

/** ---------- formatting helpers ---------- **/

/** Format a Date -> "YYYY-MM-DD" (local). */
export function formatDateLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Convert "HH:mm" -> "h:mm AM/PM". */
export function to12h(hhmm = "") {
  if (!hhmm) return "";
  const hm = _parseHHmm(hhmm);
  if (!hm) return hhmm;

  let [h, m] = hm;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Convert "HH:mm-HH:mm" -> "h:mm AM/PM – h:mm AM/PM". */
export function formatTimeRange(range = "") {
  if (!range) return "";
  const [start, end] = _splitTimeOrRange(range);
  if (!end) return to12h(start);
  return `${to12h(start)} – ${to12h(end)}`;
}

/**
 * Parse an ISO string (or ms) to local date/time parts.
 * @returns {{date:string,time:string}|null} date = "YYYY-MM-DD", time = "HH:mm"
 */
export function isoToLocalDateTimeParts(isoOrMs) {
  if (isoOrMs == null) return null;
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return null;

  const date = formatDateLocal(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date, time: `${hh}:${mm}` };
}
