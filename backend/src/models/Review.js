import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
  volunteer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // student or org admin
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String
}, { timestamps: true });

export default mongoose.model("Review", reviewSchema);
