import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import ChatConversation from "../models/ChatConversation.js";
import ChatMessage from "../models/ChatMessage.js";
import Notification from "../models/Notification.js";

import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const router = Router();
const isId = (id) => mongoose.Types.ObjectId.isValid((id || "").trim());

/* =========================
   UPLOADS DIRECTORY
   ========================= */
// server.js serves: app.use("/uploads", express.static(uploadsDir))
// server file: /project/src/server.js
// this file:   /project/src/routes/chat.routes.js
// uploads dir: /project/uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsRoot =
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

/* =========================
   MULTER CONFIG
   ========================= */
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "10", 10); // default 10MB

const allowedMimes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const allowedExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsRoot),
  filename: (_req, file, cb) => {
    const original = file.originalname || "file";
    const safeBase = path.basename(original).replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}_${safeBase}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const { mimetype = "", originalname = "" } = file;
  const ext = path.extname(originalname || "").toLowerCase();

  if (allowedMimes.has(mimetype)) return cb(null, true);

  // Some OS/browsers send application/octet-stream
  if (mimetype === "application/octet-stream" && allowedExts.has(ext)) {
    return cb(null, true);
  }

  // Be lenient for images where ext is allowed
  if (mimetype.startsWith("image/") && allowedExts.has(ext)) {
    return cb(null, true);
  }

  return cb(new Error("File type not allowed"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// Helper to read my unread from Map/object on lean docs
const getMyUnread = (doc, meStr) => {
  if (!doc?.unread) return 0;
  if (typeof doc.unread.get === "function") return doc.unread.get(meStr) || 0;
  return doc.unread[meStr] || 0;
};

// Helper to compute absolute base URL for this request
function getBaseURL(req) {
  // Prefer explicit PUBLIC_BASE_URL if provided (e.g. http://localhost:5000)
  const envUrl = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  return `${proto}://${host}`;
}

/* =========================
   CONVERSATIONS
   ========================= */

/**
 * GET /api/chat/conversations
 * Return my conversations: participants (name, role), last message, my unread.
 */
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const me = req.user._id;
    const meStr = String(me);

    const list = await ChatConversation.find({ participants: me })
      .sort({ lastMessageAt: -1 })
      .populate("participants", "name role")
      .lean();

    const shaped = list.map((c) => ({
      _id: c._id,
      participants: c.participants, // [{_id,name,role}, ...]
      sessionRequest: c.sessionRequest,
      lastMessageAt: c.lastMessageAt,
      lastMessage: c.lastMessage,
      unread: getMyUnread(c, meStr),
    }));

    res.json(shaped);
  } catch (err) {
    console.error("GET /api/chat/conversations error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/chat/conversations/open
 * body: { userId?: string, sessionRequestId?: string }
 * Find/create conversation between me and target; optionally tied to a session request.
 */
router.post("/conversations/open", requireAuth, async (req, res) => {
  try {
    const me = req.user._id;
    const meStr = String(me);
    const { userId, sessionRequestId } = req.body || {};

    if (!userId && !sessionRequestId) {
      return res
        .status(400)
        .json({ message: "userId or sessionRequestId required" });
    }

    const q = { participants: { $all: [me] } };
    if (userId) q.participants.$all.push(userId);
    if (sessionRequestId && isId(sessionRequestId))
      q.sessionRequest = sessionRequestId;

    let conv = await ChatConversation.findOne(q);
    if (!conv) {
      const participants = userId ? [me, userId] : [me];
      conv = await ChatConversation.create({
        participants,
        sessionRequest: sessionRequestId || null,
        unread: {},
      });
    }

    const full = await ChatConversation.findById(conv._id)
      .populate("participants", "name role")
      .lean();

    res.json({
      ...full,
      unread: getMyUnread(full, meStr),
    });
  } catch (err) {
    console.error("POST /api/chat/conversations/open error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/chat/:conversationId/messages?limit=50
 * Fetch messages oldest->newest for smooth scrolling.
 */
router.get("/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!isId(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    const conv = await ChatConversation.findById(conversationId);
    if (!conv) return res.status(404).json({ message: "Conversation not found" });

    const allowed = conv.participants.some(
      (p) => String(p) === String(req.user._id)
    );
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);
    const msgs = await ChatMessage.find({ conversation: conversationId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    res.json(msgs);
  } catch (err) {
    console.error("GET /api/chat/:conversationId/messages error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/chat/:conversationId/read
 * Mark all messages as read for me; reset my unread counter.
 */
router.post("/:conversationId/read", requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!isId(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    const conv = await ChatConversation.findById(conversationId);
    if (!conv) return res.status(404).json({ message: "Conversation not found" });

    const allowed = conv.participants.some(
      (p) => String(p) === String(req.user._id)
    );
    if (!allowed) return res.status(403).json({ message: "Forbidden" });

    await ChatMessage.updateMany(
      { conversation: conversationId, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    conv.unread.set(String(req.user._id), 0);
    await conv.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/chat/:conversationId/read error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   ATTACHMENT UPLOAD (multipart)
   ========================= */
/**
 * POST /api/chat/upload
 * form-data: files[]=... (multiple)
 * Returns: [{ url, path, name, mime, size }]
 *
 * NOTE:
 * - `url` is an ABSOLUTE URL (e.g. http://localhost:5000/uploads/123_file.pdf)
 * - `path` is the relative path (/uploads/123_file.pdf) if you want to store compactly
 * - Ensure server.js serves: app.use("/uploads", express.static(uploadsDir, ...))
 */
router.post(
  "/upload",
  requireAuth,
  (req, res, next) => {
    const handler = upload.array("files", 6);
    handler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const code = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(code).json({
          message:
            err.code === "LIMIT_FILE_SIZE"
              ? `File too large. Max ${MAX_UPLOAD_MB}MB`
              : err.message || "Upload failed",
        });
      }
      if (err) {
        return res.status(400).json({ message: err.message || "Upload failed" });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const base = getBaseURL(req); // <- build absolute URL origin
      const files = Array.isArray(req.files) ? req.files : [];
      const items = files.map((f) => {
        const filename = path.basename(f.path);
        const relPath = `/uploads/${filename}`;
        return {
          url: `${base}${relPath}`, // ABSOLUTE URL for immediate opening
          path: relPath,            // Relative (useful to store in DB)
          name: f.originalname,
          mime: f.mimetype,
          size: f.size,
        };
      });
      return res.json(items);
    } catch (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ message: err.message || "Upload failed" });
    }
  }
);

export default router;
