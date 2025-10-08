// src/server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import { connectDB } from "./utils/db.js";

import authRoutes from "./routes/auth.routes.js";
import volunteerRoutes from "./routes/volunteer.routes.js";
import studentRoutes from "./routes/student.routes.js";
import sessionRoutes from "./routes/session.routes.js";
import userRoutes from "./routes/user.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import rtcRoutes from "./routes/rtc.routes.js";

import ChatConversation from "./models/ChatConversation.js";
import ChatMessage from "./models/ChatMessage.js";
import Notification from "./models/Notification.js";
import User from "./models/user.js";

// ✅ ensure the scheduler file is src/services/scheduler.js
import createScheduler from "./services/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------------------ middleware ------------------------------ */
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);

// keep JSON large enough for webhook payloads if needed
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// health
app.get("/", (_req, res) => res.json({ ok: true, name: "ShikshaDaan API" }));

// uploads directory (shared with chat routes)
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));
console.log("[BE] Serving /uploads from:", uploadsDir);

/* --------------------------------- routes -------------------------------- */
app.use("/api/auth", authRoutes);
app.use("/api/volunteers", volunteerRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", chatRoutes);

// ✅ Zoom + RTC routes (now include /zoom/meeting, /zoom/webhook, etc.)
app.use("/api/rtc", rtcRoutes);

/* ------------------------------ http + socket ----------------------------- */
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
});
export const getIO = () => io;

// attach io to app for route handlers & scheduler
app.set("io", io);
app.locals.io = io;

/* -------------------------------- scheduler ------------------------------- */
let scheduler = null;
try {
  scheduler = createScheduler && typeof createScheduler === "function" ? createScheduler(io) : null;
  app.set("scheduler", scheduler);
  app.locals.scheduler = scheduler;
  console.log("[BE] Scheduler initialized");
} catch (e) {
  console.warn("[BE] Scheduler init failed:", e?.message || e);
}

/* --------------------------- socket auth middleware ----------------------- */
// Accept token in: socket.handshake.auth.token OR socket.handshake.query.token OR Authorization header
const userSocketMap = new Map(); // userId -> socketId
io.use(async (socket, next) => {
  try {
    const authToken =
      socket.handshake?.auth?.token ||
      socket.handshake?.query?.token ||
      (socket.handshake?.headers?.authorization || "").replace("Bearer ", "") ||
      "";

    if (!authToken) return next(new Error("No token"));

    const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
    if (!decoded || !decoded.id) return next(new Error("Invalid token"));

    const user = await User.findById(decoded.id).select("_id name role");
    if (!user) return next(new Error("User not found"));

    socket.user = { _id: user._id, name: user.name, role: user.role };
    return next();
  } catch (err) {
    console.warn("[IO] Socket auth failed:", err?.message || err);
    return next(new Error("Unauthorized"));
  }
});

/* ----------------------------- socket handlers ---------------------------- */
io.on("connection", (socket) => {
  const me = String(socket.user?._id || "");
  console.log(`[IO] connected socket=${socket.id} user=${me || "unknown"}`);

  if (me) {
    userSocketMap.set(me, socket.id);
    socket.join(`user:${me}`); // personal room
  }

  // ---- WebRTC call events (high-level) ----
  socket.on("call:join", ({ roomId, userId, name } = {}) => {
    if (!roomId || !userId) return;
    socket.join(roomId);
    socket.data.userId = userId;
    socket.to(roomId).emit("call:ready", { peerId: userId, name });
  });

  socket.on("call:offer", ({ roomId, to, offer, from } = {}) => {
    if (!roomId || !offer || !from) return;
    if (to) {
      const sid = userSocketMap.get(String(to));
      if (sid) return io.to(sid).emit("call:offer", { from, offer });
    }
    socket.to(roomId).emit("call:offer", { from, offer });
  });

  socket.on("call:answer", ({ roomId, answer, from, to } = {}) => {
    if (!roomId || !answer || !from) return;
    if (to) {
      const sid = userSocketMap.get(String(to));
      if (sid) return io.to(sid).emit("call:answer", { from, answer });
    }
    socket.to(roomId).emit("call:answer", { from, answer });
  });

  socket.on("call:ice", ({ roomId, candidate, from, to } = {}) => {
    if (!roomId || !candidate || !from) return;
    if (to) {
      const sid = userSocketMap.get(String(to));
      if (sid) return io.to(sid).emit("call:ice", { from, candidate });
    }
    socket.to(roomId).emit("call:ice", { from, candidate });
  });

  socket.on("call:leave", ({ roomId, userId } = {}) => {
    if (!roomId || !userId) return;
    socket.leave(roomId);
    socket.to(roomId).emit("call:leave", { userId });
  });

  // ---- rtc shim events (socket-id based) ----
  socket.on("rtc:join", ({ roomId, user } = {}) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.to(roomId).emit("rtc:peer-joined", { socketId: socket.id, user });
  });
  socket.on("rtc:leave", ({ roomId } = {}) => {
    if (!roomId) return;
    socket.leave(roomId);
    socket.to(roomId).emit("rtc:peer-left", { socketId: socket.id });
  });
  socket.on("rtc:offer", ({ to, sdp, roomId } = {}) => { if (to) io.to(to).emit("rtc:offer", { from: socket.id, sdp, roomId }); });
  socket.on("rtc:answer", ({ to, sdp, roomId } = {}) => { if (to) io.to(to).emit("rtc:answer", { from: socket.id, sdp, roomId }); });
  socket.on("rtc:ice", ({ to, candidate, roomId } = {}) => { if (to) io.to(to).emit("rtc:ice", { from: socket.id, candidate, roomId }); });

  // ---- Chat events ----
  socket.on("conversation:typing", async ({ conversationId, isTyping } = {}) => {
    try {
      if (!conversationId) return;
      const meId = String(socket.user._id);
      const conv = await ChatConversation.findById(conversationId);
      if (!conv) return;
      const isParticipant = conv.participants.some((p) => String(p) === meId);
      if (!isParticipant) return;
      socket.to(`conv:${conversationId}`).emit("conversation:typing", { conversationId, userId: meId, isTyping });
    } catch (err) { console.error("conversation:typing error", err); }
  });

  socket.on("conversation:join", (conversationId) => {
    if (!conversationId) return;
    socket.join(`conv:${conversationId}`);
  });

  socket.on("message:send", async ({ conversationId, text, attachments } = {}) => {
    try {
      if (!conversationId) return;
      const meId = String(socket.user._id);
      const conv = await ChatConversation.findById(conversationId);
      if (!conv) return;
      const isParticipant = conv.participants.some((p) => String(p) === meId);
      if (!isParticipant) return;

      const safeText = (text || "").toString().slice(0, 4000);
      const safeAttachments = Array.isArray(attachments)
        ? attachments.map((a) => ({ url: a.url, name: a.name, mime: a.mime, size: a.size }))
        : [];

      if (!safeText && safeAttachments.length === 0) return;

      const msg = await ChatMessage.create({
        conversation: conv._id,
        sender: meId,
        text: safeText,
        attachments: safeAttachments,
        readBy: [socket.user._id],
      });

      conv.lastMessage = safeText || (safeAttachments.length ? `[${safeAttachments.length} attachment(s)]` : "");
      conv.lastMessageAt = new Date();
      conv.participants.forEach((p) => {
        const pid = String(p);
        if (pid !== meId) {
          const prev = conv.unread.get(pid) || 0;
          conv.unread.set(pid, prev + 1);
        }
      });
      await conv.save();

      io.to(`conv:${conv._id}`).emit("message:new", { conversationId: String(conv._id), message: msg });

      for (const p of conv.participants) {
        const pid = String(p);
        if (pid !== meId) {
          io.to(`user:${pid}`).emit("conversations:updated", { conversationId: String(conv._id) });
          try {
            await Notification.create({
              user: pid,
              type: "chat_message",
              payload: { conversationId: conv._id, from: meId, text: msg.text },
            });
          } catch (e) {
            console.warn("Failed to create notification for chat message:", e?.message || e);
          }
        }
      }
    } catch (err) {
      console.error("message:send error", err);
    }
  });

  socket.on("conversation:read", async ({ conversationId } = {}) => {
    try {
      if (!conversationId) return;
      const meId = String(socket.user._id);
      const conv = await ChatConversation.findById(conversationId);
      if (!conv) return;
      const isParticipant = conv.participants.some((p) => String(p) === meId);
      if (!isParticipant) return;

      await ChatMessage.updateMany(
        { conversation: conv._id, readBy: { $ne: socket.user._id } },
        { $addToSet: { readBy: socket.user._id } }
      );
      conv.unread.set(meId, 0);
      await conv.save();

      io.to(`conv:${conv._id}`).emit("conversation:read", { conversationId: String(conv._id), by: meId });
      io.to(`user:${meId}`).emit("conversations:updated", { conversationId: String(conv._id) });
    } catch (err) {
      console.error("conversation:read error", err);
    }
  });

  // disconnect
  socket.on("disconnect", (reason) => {
    console.log(`[IO] disconnected socket=${socket.id} user=${me || "unknown"} reason=${reason}`);
    if (me) userSocketMap.delete(me);

    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      if (typeof roomId === "string" && (roomId.startsWith("user:") || roomId.startsWith("conv:"))) continue;
      socket.to(roomId).emit("call:leave", { socketId: socket.id });
      socket.to(roomId).emit("rtc:peer-left", { socketId: socket.id });
    }
  });
});

/* ------------------------------- start server ------------------------------ */
const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    server.listen(PORT, () =>
      console.log(`API + Sockets on http://localhost:${PORT}\nZoom host: ${process.env.ZOOM_DEFAULT_HOST_EMAIL || "not set"}`)
    );
  })
  .catch((err) => {
    console.error("DB connect failed:", err);
    process.exit(1);
  });

/* ----------------------------- graceful shutdown --------------------------- */
async function shutdown(signal) {
  try {
    console.log(`[BE] Shutting down due to ${signal}...`);
    if (scheduler && typeof scheduler.clearAll === "function") {
      try {
        scheduler.clearAll();
      } catch (e) {
        console.warn("Failed to clear scheduler timers:", e?.message || e);
      }
    }
    server.close(() => {
      console.log("[BE] HTTP server closed");
      process.exit(0);
    });
    // force exit after 10s
    setTimeout(() => {
      console.warn("[BE] Force exiting");
      process.exit(1);
    }, 10000).unref();
  } catch (e) {
    console.error("[BE] shutdown error", e);
    process.exit(1);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
