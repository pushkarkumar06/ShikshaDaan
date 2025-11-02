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
   ME (profile, badges, network, progress)
   ========================================================= */

// Get my profile (safe, no password)
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

// Recompute my badges (volunteers only)
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

// My network (followers & following)
router.get("/me/network", requireAuth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id)
      .populate("followers", "name role profilePicture")
      .populate("following", "name role profilePicture")
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

// === Student Progress Tracking ===
router.get("/me/progress", requireAuth, async (req, res) => {
  try {
    const uid = req.user._id;

    // load student's sessions
    const sessions = await SessionRequest.find({ student: uid }).lean();

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === "completed").length;

    // hours learned: assume 1 hr per completed session unless you store durations
    const hoursLearned = completedSessions * 1;

    const scheduledSessions = sessions
      .filter(s => s.status === "scheduled" || s.final)
      .map(s => ({
        _id: s._id,
        subject: s.subject,
        date: s.final?.date || s.proposed?.date || null,
        time: s.final?.time || s.proposed?.time || null,
        volunteer: s.volunteer,
      }));

    // reviews authored by this student
    const reviews = await Review.find({ author: uid }).lean();
    const avgRating = reviews.length
      ? reviews.reduce((a, r) => a + (r.rating || 0), 0) / reviews.length
      : null;

    // subjects/topics covered
    const subjectsCount = {};
    for (const s of sessions) {
      const sub = s.subject || "General";
      subjectsCount[sub] = (subjectsCount[sub] || 0) + 1;
    }
    const subjects = Object.entries(subjectsCount)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count);

    // badges (from user doc)
    const me = await User.findById(uid).lean();
    const badges = me?.badges || [];

    // weekly streak: distinct days with completed session in last 7 days
    const now = new Date();
    const sevenAgo = new Date();
    sevenAgo.setDate(now.getDate() - 6);
    const days = new Set();
    sessions.forEach(s => {
      const d = s.completedAt || s.final?.date || s.createdAt;
      if (d) {
        const day = new Date(d).toISOString().slice(0, 10);
        const dt = new Date(day);
        if (dt >= new Date(sevenAgo.toISOString().slice(0, 10))) days.add(day);
      }
    });
    const weeklyStreak = days.size;

    return res.json({
      totalSessions,
      completedSessions,
      hoursLearned,
      scheduledSessions,
      avgRating,
      subjects,
      badges,
      weeklyStreak,
    });
  } catch (err) {
    console.error("GET /users/me/progress failed:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* =========================================================
   PUBLIC (badges, stats, dashboard)
   ========================================================= */

// Get user badges (by userId)
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

// Volunteer stats (public)
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

// Volunteer dashboard (public)
router.get("/:id/dashboard", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const core = await computeVolunteerStats(id);

    const userDoc = await User.findById(id, { badges: 1, name: 1, role: 1 }).lean();
    const badges = userDoc?.badges || [];

    const subjectAgg = await SessionRequest.aggregate([
      { $match: { volunteer: new mongoose.Types.ObjectId(id), status: "scheduled" } },
      { $group: { _id: "$subject", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const recentReviews = await Review.find({ volunteer: id })
      .populate("author", "name role")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentSessions = await SessionRequest.find({ volunteer: id, status: "scheduled" })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = await SessionRequest.find({
      volunteer: id,
      status: "scheduled",
      "final.date": { $gte: today }
    })
      .sort({ "final.date": 1, "final.time": 1 })
      .limit(5)
      .lean();

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

/* =========================================================
   NETWORK (followers / following)
   ========================================================= */

// Followers list
router.get("/:id/followers", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const u = await User.findById(id).populate("followers", "name role profilePicture").lean();
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

    const u = await User.findById(id).populate("following", "name role profilePicture").lean();
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

// Follow any user
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

    return res.json({ ok: true, message: "Followed successfully" });
  } catch (err) {
    console.error("POST /users/:id/follow failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Unfollow any user
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

    return res.json({ ok: true, message: "Unfollowed successfully" });
  } catch (err) {
    console.error("DELETE /users/:id/follow failed:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
