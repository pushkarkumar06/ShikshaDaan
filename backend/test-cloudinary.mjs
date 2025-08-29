import 'dotenv/config';
import cloudinary from './src/utils/cloudinary.js';

async function run() {
  try {
    const res = await cloudinary.api.ping();
    console.log("✅ Cloudinary connected:", res);
  } catch (err) {
    console.error("❌ Cloudinary error:", err?.message || err);
  }
}
run();


