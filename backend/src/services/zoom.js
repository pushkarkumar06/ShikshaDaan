export const createZoomMeetingStub = async ({ topic, date, time }) => {
    // TODO: replace with real Zoom OAuth flow and meetings API call.
    // For now, produce a deterministic fake link:
    const slug = `${topic || "Class"}-${date}-${time}`.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    return `https://zoom.example.com/${slug}`;
  };
  