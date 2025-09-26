// src/services/zoom.js

import crypto from "crypto";

/**
 * Create a fake Zoom meeting link for now.
 * Later you can replace this with a call to Zoom's API (JWT/OAuth).
 *
 * @param {Object} opts
 * @param {String} opts.topic - Meeting topic/title
 * @param {String} opts.date - YYYY-MM-DD (session date)
 * @param {String} opts.time - HH:MM or HH:MM-HH:MM (session time)
 * @param {Number} opts.durationMinutes - Optional duration in minutes
 *
 * @returns {Promise<Object>} { joinUrl, meetingId, linkCreatedAt, linkExpiresAt }
 */
export async function createZoomMeetingStub({ topic, date, time, durationMinutes = 30 }) {
  // Create a deterministic slug
  const slugBase = `${topic || "Session"}-${date}-${time}`;
  const slug = slugBase.replace(/[^a-z0-9]/gi, "-").toLowerCase();

  // Fake meeting ID
  const meetingId = crypto.createHash("md5").update(slugBase).digest("hex").slice(0, 12);

  // Fake URL
  const joinUrl = `https://zoom.example.com/${slug}`;

  // Timestamps
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + durationMinutes * 60000);

  return {
    meetingId,
    joinUrl,
    linkCreatedAt: createdAt,
    linkExpiresAt: expiresAt,
    durationMinutes,
  };
}

/**
 * Example fallback: if Zoom is not available, use our internal room.
 * This can be integrated with your WebRTC CallRoom.vue component.
 *
 * @param {Object} opts
 * @param {String} opts.sessionId
 *
 * @returns {Promise<Object>} { joinUrl, meetingId }
 */
export async function createInternalMeetingLink({ sessionId }) {
  const joinUrl = `https://your-app.example.com/room/${sessionId}`;
  return {
    meetingId: sessionId,
    joinUrl,
    linkCreatedAt: new Date(),
    linkExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // default 1hr expiry
  };
}
