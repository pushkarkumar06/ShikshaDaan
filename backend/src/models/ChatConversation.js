import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  // two (or more) participants (we’ll keep it 1:1 for now)
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  // optional link to a SessionRequest conversation
  sessionRequest: { type: mongoose.Schema.Types.ObjectId, ref: "SessionRequest", default: null },
  // computed fields
  lastMessageAt: { type: Date, default: Date.now },
  lastMessage: { type: String, default: "" },

  // unread counts per participant: { userId -> number }
  unread: {
    type: Map,
    of: Number,
    default: {}
  }
}, { timestamps: true });

conversationSchema.index({ participants: 1 });

export default mongoose.model("ChatConversation", conversationSchema);
