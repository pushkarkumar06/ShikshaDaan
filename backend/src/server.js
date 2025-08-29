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
import fs from "fs"; // ← add this

import { connectDB } from "./utils/db.js";

import authRoutes from "./routes/auth.routes.js";
import volunteerRoutes from "./routes/volunteer.routes.js";
import sessionRoutes from "./routes/session.routes.js";
import userRoutes from "./routes/user.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import chatRoutes from "./routes/chat.routes.js";

// Models used by sockets
import ChatConversation from "./models/ChatConversation.js";
import ChatMessage from "./models/ChatMessage.js";
import Notification from "./models/Notification.js";
import User from "./models/user.js";

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
app.use("/api/sessions", sessionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", chatRoutes);

// --- http + socket.io server ---
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  },
});

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

io.on("connection", (socket) => {
  const me = String(socket.user._id);
  socket.join(`user:${me}`); // personal room for counters etc.

  // Join a conversation room
  socket.on("conversation:join", (conversationId) => {
    if (!conversationId) return;
    socket.join(`conv:${conversationId}`);
  });

  // Send a message (supports attachments)
  socket.on("message:send", async ({ conversationId, text, attachments }) => {
    try {
      if (!conversationId) return;

      const conv = await ChatConversation.findById(conversationId);
      if (!conv) return;
      const isParticipant = conv.participants.some((p) => String(p) === me);
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

      if (!safeText && safeAttachments.length === 0) return; // nothing to send

      const msg = await ChatMessage.create({
        conversation: conv._id,
        sender: me,
        text: safeText,
        attachments: safeAttachments,
        readBy: [socket.user._id], // sender has read it
      });

      // Update conversation metadata + unread counters
      conv.lastMessage =
        safeText || (safeAttachments.length ? `[${safeAttachments.length} attachment(s)]` : "");
      conv.lastMessageAt = new Date();
      conv.participants.forEach((p) => {
        const pid = String(p);
        if (pid !== me) {
          const prev = conv.unread.get(pid) || 0;
          conv.unread.set(pid, prev + 1);
        }
      });
      await conv.save();

      // Emit to conversation room
      io.to(`conv:${conv._id}`).emit("message:new", {
        conversationId: String(conv._id),
        message: msg,
      });

      // Notify other participants for red dot / list refresh
      for (const p of conv.participants) {
        const pid = String(p);
        if (pid !== me) {
          io.to(`user:${pid}`).emit("conversations:updated", {
            conversationId: String(conv._id),
          });
          await Notification.create({
            user: pid,
            type: "chat_message",
            payload: { conversationId: conv._id, from: me, text: msg.text },
          });
        }
      }
    } catch (err) {
      console.error("message:send error", err);
    }
  });

  // Mark conversation as read
  socket.on("conversation:read", async ({ conversationId }) => {
    try {
      if (!conversationId) return;

      const conv = await ChatConversation.findById(conversationId);
      if (!conv) return;
      const isParticipant = conv.participants.some((p) => String(p) === me);
      if (!isParticipant) return;

      await ChatMessage.updateMany(
        { conversation: conv._id, readBy: { $ne: socket.user._id } },
        { $addToSet: { readBy: socket.user._id } }
      );

      conv.unread.set(me, 0);
      await conv.save();

      io.to(`conv:${conv._id}`).emit("conversation:read", {
        conversationId: String(conv._id),
        by: me,
      });
      io.to(`user:${me}`).emit("conversations:updated", {
        conversationId: String(conv._id),
      });
    } catch (err) {
      console.error("conversation:read error", err);
    }
  });
});

// --- start ---
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () =>
    console.log(`API + Sockets on http://localhost:${PORT}`)
  );
});

