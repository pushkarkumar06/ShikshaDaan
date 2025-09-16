// src/server.js
import dotenv from "dotenv";
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
import rtcRoutes from "./routes/rtc.routes.js"; // <-- added

// Models used by sockets
import ChatConversation from "./models/ChatConversation.js";
import ChatMessage from "./models/ChatMessage.js";
import Notification from "./models/Notification.js";
import User from "./models/user.js";
import createScheduler from "./services/scheduler.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- middleware ---
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

// --- health ---
app.get("/", (_req, res) => res.json({ ok: true, name: "ShikshaDaan API" }));

// Serve uploads (shared path with chat.routes.js)
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
// ensure folder exists (sync is fine at startup)
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));
console.log("[BE] Serving /uploads from:", uploadsDir);

// --- routes ---
app.use("/api/auth", authRoutes);
app.use("/api/volunteers", volunteerRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/rtc", rtcRoutes); // <-- mounted

// --- http + socket.io server ---
const server = http.createServer(app);
export const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

export const getIO = () => io; // Helper function to get io instance

// Make io accessible in routes via both app.get('io') and req.app.locals.io
app.set('io', io);
app.locals.io = io; // for backward compatibility

// Initialize and register scheduler
const scheduler = createScheduler(io);
app.set('scheduler', scheduler);

// Simple map userId -> socketId for direct signaling (helpful for one-to-one)
const userSocketMap = new Map();

// Socket auth: reuse JWT (supports auth.token or Authorization header)
io.use(async (socket, next) => {
  try {
    const bearer =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
      "";

    if (!bearer) return next(new Error("No token"));
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return next(new Error("User not found"));

    socket.user = { _id: user._id, name: user.name, role: user.role };
    next();
  } catch (_err) {
    next(new Error("Unauthorized"));
  }
});

// WebRTC & Chat Socket Events
io.on("connection", (socket) => {
  const me = String(socket.user?._id);
  console.log(`Socket connected: ${socket.id} (${me || "unauthenticated"})`);

  // track mapping for direct emits
  if (me) {
    userSocketMap.set(me, socket.id);
  }

  // Join user's personal room for notifications
  if (me) {
    socket.join(`user:${me}`);
  }

  // WebRTC Call Events (high-level API: roomId + userId + name)
  socket.on("call:join", ({ roomId, userId, name } = {}) => {
    if (!roomId || !userId) return;
    console.log(`User ${userId} (${name}) joining room: ${roomId}`);
    socket.join(roomId);
    socket.data.userId = userId;
    socket.to(roomId).emit("call:ready", { peerId: userId, name });
  });

  socket.on("call:offer", ({ roomId, to, offer, from } = {}) => {
    if (!roomId || !offer || !from) return;
    console.log(`Offer from ${from} to ${to || "(broadcast)"} in room ${roomId}`);
    if (to) {
      const sid = userSocketMap.get(String(to));
      if (sid) return io.to(sid).emit("call:offer", { from, offer });
    }
    socket.to(roomId).emit("call:offer", { from, offer });
  });

  socket.on("call:answer", ({ roomId, answer, from, to } = {}) => {
    if (!roomId || !answer || !from) return;
    console.log(`Answer from ${from} in room ${roomId}`);
    if (to) {
      const sid = userSocketMap.get(String(to));
      if (sid) return io.to(sid).emit("call:answer", { from, answer });
    }
    socket.to(roomId).emit("call:answer", { from, answer });
  });

  socket.on("call:ice", ({ roomId, candidate, from, to } = {}) => {
    if (!roomId || !candidate || !from) return;
    // try to deliver directly to 'to' user if provided
    if (to) {
      const sid = userSocketMap.get(String(to));
      if (sid) return io.to(sid).emit("call:ice", { from, candidate });
    }
    socket.to(roomId).emit("call:ice", { from, candidate });
  });

  socket.on("call:leave", ({ roomId, userId } = {}) => {
    if (!roomId || !userId) return;
    console.log(`User ${userId} leaving room: ${roomId}`);
    socket.leave(roomId);
    socket.to(roomId).emit("call:leave", { userId });
  });

  // WebRTC Signaling Events (alternate API using socket IDs)
  socket.on("rtc:join", ({ roomId, user } = {}) => {
    if (!roomId) return;
    console.log("rtc:join", { roomId, id: socket.id });
    socket.join(roomId);
    socket.to(roomId).emit("rtc:peer-joined", { socketId: socket.id, user });
  });

  socket.on("rtc:leave", ({ roomId } = {}) => {
    if (!roomId) return;
    socket.leave(roomId);
    socket.to(roomId).emit("rtc:peer-left", { socketId: socket.id });
  });

  // Offer -> forward to target socket id (expects 'to' to be a socketId)
  socket.on("rtc:offer", ({ to, sdp, roomId } = {}) => {
    if (!to) return;
    io.to(to).emit("rtc:offer", { from: socket.id, sdp, roomId });
  });

  // Answer -> forward to target socket id
  socket.on("rtc:answer", ({ to, sdp, roomId } = {}) => {
    if (!to) return;
    io.to(to).emit("rtc:answer", { from: socket.id, sdp, roomId });
  });

  // ICE candidate -> forward to target socket id
  socket.on("rtc:ice", ({ to, candidate, roomId } = {}) => {
    if (!to) return;
    io.to(to).emit("rtc:ice", { from: socket.id, candidate, roomId });
  });

  // --- Chat events ---
  socket.on("conversation:typing", async ({ conversationId, isTyping } = {}) => {
    try {
      if (!conversationId) return;
      const meId = String(socket.user._id);
      const conv = await ChatConversation.findById(conversationId);
      if (!conv) return;
      const isParticipant = conv.participants.some((p) => String(p) === meId);
      if (!isParticipant) return;
      socket.to(`conv:${conversationId}`).emit("conversation:typing", {
        conversationId,
        userId: meId,
        isTyping,
      });
    } catch (err) {
      console.error("conversation:typing error", err);
    }
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
        ? attachments.map((a) => ({
            url: a.url,
            name: a.name,
            mime: a.mime,
            size: a.size,
          }))
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

      io.to(`conv:${conv._id}`).emit("message:new", {
        conversationId: String(conv._id),
        message: msg,
      });

      for (const p of conv.participants) {
        const pid = String(p);
        if (pid !== meId) {
          io.to(`user:${pid}`).emit("conversations:updated", {
            conversationId: String(conv._id),
          });
          // create a notification for recipients (non-blocking if it fails)
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

      io.to(`conv:${conv._id}`).emit("conversation:read", {
        conversationId: String(conv._id),
        by: meId,
      });
      io.to(`user:${meId}`).emit("conversations:updated", { conversationId: String(conv._id) });
    } catch (err) {
      console.error("conversation:read error", err);
    }
  });

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${me || "unauthenticated"}) - ${reason}`);
    // Remove mapping
    if (me) userSocketMap.delete(me);

    // Broadcast peer-left to rooms this socket was in
    // socket.rooms is a Set (socket.io v4)
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      if (typeof roomId === "string" && (roomId.startsWith("user:") || roomId.startsWith("conv:"))) continue;
      socket.to(roomId).emit("call:leave", { socketId: socket.id });
      socket.to(roomId).emit("rtc:peer-left", { socketId: socket.id });
    }
  });
});

// --- start ---
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () => console.log(`API + Sockets on http://localhost:${PORT}`));
});
