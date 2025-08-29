import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },     // e.g. /uploads/1699999_myfile.pdf
  name: { type: String, required: true },    // original filename
  mime: { type: String, required: true },    // content-type
  size: { type: Number, required: true },    // bytes
}, { _id: false });

const chatMessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "ChatConversation", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
  attachments: { type: [attachmentSchema], default: [] }, // NEW
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
}, { timestamps: true });

chatMessageSchema.index({ conversation: 1, createdAt: -1 });

export default mongoose.model("ChatMessage", chatMessageSchema);
