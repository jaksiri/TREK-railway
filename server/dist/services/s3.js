"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tempDir = void 0;
exports.uploadFile = uploadFile;
exports.uploadBuffer = uploadBuffer;
exports.uploadStream = uploadStream;
exports.getFileStream = getFileStream;
exports.deleteFile = deleteFile;
exports.deleteFiles = deleteFiles;
exports.fileExists = fileExists;
exports.listFiles = listFiles;
const client_s3_1 = require("@aws-sdk/client-s3");
const lib_storage_1 = require("@aws-sdk/lib-storage");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const bucket = process.env.AWS_S3_BUCKET_NAME;
const s3 = new client_s3_1.S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL,
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
});
/**
 * Upload a file from disk to S3, then delete the local temp file.
 */
async function uploadFile(key, filePath, contentType) {
    const stream = fs_1.default.createReadStream(filePath);
    const stat = fs_1.default.statSync(filePath);
    const upload = new lib_storage_1.Upload({
        client: s3,
        params: {
            Bucket: bucket,
            Key: key,
            Body: stream,
            ContentType: contentType || 'application/octet-stream',
            ContentLength: stat.size,
        },
    });
    await upload.done();
    // Clean up temp file
    try {
        fs_1.default.unlinkSync(filePath);
    }
    catch { }
}
/**
 * Upload a buffer to S3.
 */
async function uploadBuffer(key, buffer, contentType) {
    await s3.send(new client_s3_1.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
    }));
}
/**
 * Upload from a readable stream to S3.
 */
async function uploadStream(key, stream, contentType) {
    const upload = new lib_storage_1.Upload({
        client: s3,
        params: {
            Bucket: bucket,
            Key: key,
            Body: stream,
            ContentType: contentType || 'application/octet-stream',
        },
    });
    await upload.done();
}
/**
 * Get a file stream from S3 for serving.
 */
async function getFileStream(key) {
    const resp = await s3.send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }));
    return {
        stream: resp.Body,
        contentType: resp.ContentType,
        contentLength: resp.ContentLength,
    };
}
/**
 * Delete a single file from S3. Silently ignores missing keys.
 */
async function deleteFile(key) {
    try {
        await s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
    catch { }
}
/**
 * Delete multiple files from S3 in a single request (max 1000 per call).
 */
async function deleteFiles(keys) {
    if (keys.length === 0)
        return;
    // S3 DeleteObjects supports max 1000 keys per request
    for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await s3.send(new client_s3_1.DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
                Objects: batch.map((k) => ({ Key: k })),
                Quiet: true,
            },
        }));
    }
}
/**
 * Check if a file exists in S3.
 */
async function fileExists(key) {
    try {
        await s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * List all keys under a prefix. Yields keys one at a time.
 */
async function* listFiles(prefix) {
    let continuationToken;
    do {
        const resp = await s3.send(new client_s3_1.ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix || undefined,
            ContinuationToken: continuationToken,
        }));
        if (resp.Contents) {
            for (const obj of resp.Contents) {
                if (obj.Key)
                    yield obj.Key;
            }
        }
        continuationToken = resp.IsTruncated
            ? resp.NextContinuationToken
            : undefined;
    } while (continuationToken);
}
/** Shared temp directory for multer uploads before they're moved to S3 */
exports.tempDir = path_1.default.join(__dirname, '../../.tmp-uploads');
//# sourceMappingURL=s3.js.map