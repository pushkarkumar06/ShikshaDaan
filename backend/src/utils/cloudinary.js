// src/utils/cloudinary.js
import 'dotenv/config';               // <-- ensures .env is loaded here
import { v2 as cloudinary } from 'cloudinary';

/**
 * Support BOTH styles:
 *  - Separate vars: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *  - Single URL:    CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>
 */
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_URL } = process.env;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
} else if (CLOUDINARY_URL) {
  // The SDK will read CLOUDINARY_URL automatically if present
  cloudinary.config({ secure: true });
} else {
  console.warn(
    '[cloudinary] Missing credentials. Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET (or CLOUDINARY_URL).'
  );
}

export default cloudinary;


