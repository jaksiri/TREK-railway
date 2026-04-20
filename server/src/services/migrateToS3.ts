/**
 * One-time migration script: uploads existing files from disk to S3.
 *
 * Usage:
 *   node --import tsx src/services/migrateToS3.ts
 *
 * Walks /app/uploads (or ../uploads relative to server/) and uploads
 * each file to S3 with the same key structure (e.g. files/uuid.pdf).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { uploadStream } from "./s3";

const uploadsDir = path.resolve(__dirname, "../../uploads");

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else results.push(full);
  }
  return results;
}

async function main() {
  if (!process.env.AWS_S3_BUCKET_NAME) {
    console.error("AWS_S3_BUCKET_NAME is not set. Aborting.");
    process.exit(1);
  }

  const files = walkDir(uploadsDir);
  console.log(`Found ${files.length} files to migrate.`);

  let uploaded = 0;
  let failed = 0;

  for (const filePath of files) {
    const key = path.relative(uploadsDir, filePath).replace(/\\/g, "/");
    try {
      await uploadStream(key, fs.createReadStream(filePath));
      uploaded++;
      if (uploaded % 50 === 0)
        console.log(`  ${uploaded}/${files.length} uploaded...`);
    } catch (err) {
      console.error(`  Failed: ${key}`, err);
      failed++;
    }
  }

  console.log(
    `Migration complete: ${uploaded} uploaded, ${failed} failed out of ${files.length} total.`,
  );
}

main();
