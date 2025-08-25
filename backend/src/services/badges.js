// src/services/badges.js
import User from "../models/user.js";
import Volunteer from "../models/volunteer.js";
import Review from "../models/Review.js";
import SessionRequest from "../models/SessionRequest.js";

/**
 * Compute volunteer stats used for badges.
 * @param {string} volunteerUserId - the User._id of the volunteer
 * @returns {{sessionsCompleted:number, studentsHelped:number, avgRating:number, ratingsCount:number}}
 */
export async function computeVolunteerStats(volunteerUserId) {
  const [sessionsAgg, studentsAgg, ratingDoc] = await Promise.all([
    // sessions with status "scheduled"
    SessionRequest.countDocuments({ volunteer: volunteerUserId, status: "scheduled" }),

    // distinct students helped (targets) in scheduled sessions
    SessionRequest.aggregate([
      { $match: { volunteer: (await User.findById(volunteerUserId))._id, status: "scheduled" } },
      { $group: { _id: "$target" } },
      { $count: "cnt" }
    ]),

    // read current rating stats from Volunteer profile (already aggregated by your review route)
    Volunteer.findOne({ userId: volunteerUserId }, { avgRating: 1, ratingsCount: 1 }).lean()
  ]);

  const sessionsCompleted = sessionsAgg || 0;
  const studentsHelped = studentsAgg?.[0]?.cnt || 0;
  const avgRating = ratingDoc?.avgRating || 0;
  const ratingsCount = ratingDoc?.ratingsCount || 0;

  return { sessionsCompleted, studentsHelped, avgRating, ratingsCount };
}

/**
 * Award missing badges based on current stats.
 * Adds badge once; never duplicates.
 */
export async function awardBadgesForVolunteer(volunteerUserId) {
  const user = await User.findById(volunteerUserId);
  if (!user || user.role !== "volunteer") return;

  const { sessionsCompleted, studentsHelped, avgRating, ratingsCount } =
    await computeVolunteerStats(volunteerUserId);

  const have = new Set((user.badges || []).map(b => b.key));
  const add = (key, label) => {
    if (!have.has(key)) {
      user.badges.push({ key, label, earnedAt: new Date() });
      have.add(key);
    }
  };

  // ▶️ Rules
  if (sessionsCompleted >= 5) add("sessions_5", "5 Sessions Completed");
  if (studentsHelped >= 10) add("students_10", "10 Students Helped");
  if (avgRating >= 4.5 && ratingsCount >= 5) add("top_rated", "Top-rated Teacher (≥4.5)");

  await user.save();

  // Return what user has now (useful for responses if you want)
  return user.badges;
}


