// src/routes/user.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import User from "../models/user.js";
import Notification from "../models/Notification.js";
import { awardBadgesForVolunteer, computeVolunteerStats } from "../services/badges.js";
import SessionRequest from "../models/SessionRequest.js";
import Review from "../models/Review.js";
import Volunteer from "../models/volunteer.js";

const router = Router();
const isObjectId = (id) => mongoose.Types.ObjectId.isValid((id || "").trim());

/* =========================================================
   ME (safe profile, badges recompute, my network)
   ========================================================= */

// Get my profile (safe) including badges
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    delete user.password;
    return res.json(user);
  } catch (err) {
    console.error("GET /users/me failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Me: recompute badges now (handy for testing)
router.post("/me/recompute-badges", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "volunteer") {
      return res.status(403).json({ message: "Only volunteers can recompute their badges" });
    }
    const badges = await awardBadgesForVolunteer(req.user._id);
    const stats = await computeVolunteerStats(req.user._id);
    return res.json({ badges: badges || [], stats: stats || {} });
  } catch (err) {
    console.error("POST /users/me/recompute-badges failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get my network (followers & following)
router.get("/me/network", requireAuth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id)
      .populate("followers", "name role")
      .populate("following", "name role")
      .lean();
    return res.json({
      followers: u?.followers || [],
      following: u?.following || [],
    });
  } catch (err) {
    console.error("GET /users/me/network failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================================================
   PUBLIC (badges, stats, lists)
   ========================================================= */

// Public: get user's badges (by userId)
router.get("/:id/badges", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findById(id, { badges: 1, role: 1, name: 1 }).lean();
    if (!u) return res.status(404).json({ message: "User not found" });
    return res.json({ user: { _id: u._id, name: u.name, role: u.role }, badges: u.badges || [] });
  } catch (err) {
    console.error("GET /users/:id/badges failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Public stats for a volunteer (nice for profile)
router.get("/:id/stats", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const stats = await computeVolunteerStats(id);
    return res.json(stats);
  } catch (err) {
    console.error("GET /users/:id/stats failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Dashboard summary for a volunteer (public)
router.get("/:id/dashboard", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    // core stats you already compute
    const core = await computeVolunteerStats(id); // { sessionsCompleted, studentsHelped, avgRating, ratingsCount }

    // badges (from user doc)
    const userDoc = await User.findById(id, { badges: 1, name: 1, role: 1 }).lean();
    const badges = userDoc?.badges || [];

    // subject breakdown (scheduled sessions grouped by subject)
    const subjectAgg = await SessionRequest.aggregate([
      { $match: { volunteer: new mongoose.Types.ObjectId(id), status: "scheduled" } },
      { $group: { _id: "$subject", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // recent reviews (last 5)
    const recentReviews = await Review.find({ volunteer: id })
      .populate("author", "name role")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // recent scheduled sessions (last 5)
    const recentSessions = await SessionRequest.find({ volunteer: id, status: "scheduled" })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();

    // upcoming sessions (today or future, sorted soonest first)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const upcoming = await SessionRequest.find({
      volunteer: id,
      status: "scheduled",
      "final.date": { $gte: today }
    })
      .sort({ "final.date": 1, "final.time": 1 })
      .limit(5)
      .lean();

    // include volunteer profile rating fields (in case you want exact numbers)
    const volDoc = await Volunteer.findOne({ userId: id }, { avgRating: 1, ratingsCount: 1 }).lean();

    return res.json({
      user: { _id: userDoc?._id, name: userDoc?.name, role: userDoc?.role },
      metrics: {
        sessionsTaught: core.sessionsCompleted,
        studentsHelped: core.studentsHelped,
        avgRating: volDoc?.avgRating ?? core.avgRating ?? 0,
        ratingsCount: volDoc?.ratingsCount ?? core.ratingsCount ?? 0
      },
      badges,
      subjects: subjectAgg.map(s => ({ subject: s._id || "General", count: s.count })),
      recentReviews,
      recentSessions: recentSessions.map(s => ({
        _id: s._id,
        subject: s.subject,
        date: s.final?.date || s.proposed?.date,
        time: s.final?.time || s.proposed?.time,
        target: s.target,  // student/admin id
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      })),
      upcoming: upcoming.map(s => ({
        _id: s._id,
        subject: s.subject,
        date: s.final?.date,
        time: s.final?.time,
        zoomLink: s.final?.zoomLink
      }))
    });
  } catch (err) {
    console.error("GET /users/:id/dashboard failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


// Followers list
router.get("/:id/followers", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findById(id).populate("followers", "name role").lean();
    if (!u) return res.status(404).json({ message: "User not found" });
    return res.json(u.followers || []);
  } catch (err) {
    console.error("GET /users/:id/followers failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Following list
router.get("/:id/following", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findById(id).populate("following", "name role").lean();
    if (!u) return res.status(404).json({ message: "User not found" });
    return res.json(u.following || []);
  } catch (err) {
    console.error("GET /users/:id/following failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =========================================================
   ACTIONS (follow / unfollow)
   ========================================================= */

// Follow (any role → any role)
router.post("/:id/follow", requireAuth, async (req, res) => {
  try {
    const targetId = (req.params.id || "").trim();
    const me = req.user._id.toString();

    if (!isObjectId(targetId)) return res.status(400).json({ message: "Invalid id" });
    if (me === targetId) return res.status(400).json({ message: "Cannot follow yourself" });

    const [meDoc, targetDoc] = await Promise.all([
      User.findById(me),
      User.findById(targetId),
    ]);
    if (!meDoc || !targetDoc) return res.status(404).json({ message: "User not found" });

    await Promise.all([
      User.updateOne({ _id: me }, { $addToSet: { following: targetDoc._id } }),
      User.updateOne({ _id: targetDoc._id }, { $addToSet: { followers: meDoc._id } }),
      Notification.create({
        user: targetDoc._id,
        type: "follow",
        payload: { followerId: meDoc._id }
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /users/:id/follow failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Unfollow (DELETE same path)
router.delete("/:id/follow", requireAuth, async (req, res) => {
  try {
    const targetId = (req.params.id || "").trim();
    const me = req.user._id.toString();

    if (!isObjectId(targetId)) return res.status(400).json({ message: "Invalid id" });
    if (me === targetId) return res.status(400).json({ message: "Cannot unfollow yourself" });

    await Promise.all([
      User.updateOne({ _id: me }, { $pull: { following: targetId } }),
      User.updateOne({ _id: targetId }, { $pull: { followers: me } }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /users/:id/follow failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
