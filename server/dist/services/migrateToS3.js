"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * One-time migration script: uploads existing files from disk to S3.
 *
 * Usage:
 *   node --import tsx src/services/migrateToS3.ts
 *
 * Walks /app/uploads (or ../uploads relative to server/) and uploads
 * each file to S3 with the same key structure (e.g. files/uuid.pdf).
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const s3_1 = require("./s3");
const uploadsDir = path_1.default.resolve(__dirname, '../../uploads');
function walkDir(dir) {
    const results = [];
    if (!fs_1.default.existsSync(dir))
        return results;
    for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const full = path_1.default.join(dir, entry.name);
        if (entry.isDirectory())
            results.push(...walkDir(full));
        else
            results.push(full);
    }
    return results;
}
async function main() {
    if (!process.env.AWS_S3_BUCKET_NAME) {
        console.error('AWS_S3_BUCKET_NAME is not set. Aborting.');
        process.exit(1);
    }
    const files = walkDir(uploadsDir);
    console.log(`Found ${files.length} files to migrate.`);
    let uploaded = 0;
    let failed = 0;
    for (const filePath of files) {
        const key = path_1.default.relative(uploadsDir, filePath).replace(/\\/g, '/');
        try {
            await (0, s3_1.uploadStream)(key, fs_1.default.createReadStream(filePath));
            uploaded++;
            if (uploaded % 50 === 0)
                console.log(`  ${uploaded}/${files.length} uploaded...`);
        }
        catch (err) {
            console.error(`  Failed: ${key}`, err);
            failed++;
        }
    }
    console.log(`Migration complete: ${uploaded} uploaded, ${failed} failed out of ${files.length} total.`);
}
main();
//# sourceMappingURL=migrateToS3.js.map