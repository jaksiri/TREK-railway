import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

const bucket = process.env.AWS_S3_BUCKET_NAME!;

const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});

/**
 * Upload a file from disk to S3, then delete the local temp file.
 */
export async function uploadFile(
  key: string,
  filePath: string,
  contentType?: string,
): Promise<void> {
  const stream = fs.createReadStream(filePath);
  const stat = fs.statSync(filePath);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: stream,
      ContentType: contentType || "application/octet-stream",
      ContentLength: stat.size,
    },
  });

  await upload.done();

  // Clean up temp file
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

/**
 * Upload a buffer to S3.
 */
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType?: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    }),
  );
}

/**
 * Upload from a readable stream to S3.
 */
export async function uploadStream(
  key: string,
  stream: Readable | fs.ReadStream,
  contentType?: string,
): Promise<void> {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: stream,
      ContentType: contentType || "application/octet-stream",
    },
  });
  await upload.done();
}

/**
 * Get a file stream from S3 for serving.
 */
export async function getFileStream(
  key: string,
): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return {
    stream: resp.Body as Readable,
    contentType: resp.ContentType,
    contentLength: resp.ContentLength,
  };
}

/**
 * Delete a single file from S3. Silently ignores missing keys.
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {}
}

/**
 * Delete multiple files from S3 in a single request (max 1000 per call).
 */
export async function deleteFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  // S3 DeleteObjects supports max 1000 keys per request
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((k) => ({ Key: k })),
          Quiet: true,
        },
      }),
    );
  }
}

/**
 * Check if a file exists in S3.
 */
export async function fileExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * List all keys under a prefix. Yields keys one at a time.
 */
export async function* listFiles(prefix: string): AsyncGenerator<string> {
  let continuationToken: string | undefined;

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      }),
    );

    if (resp.Contents) {
      for (const obj of resp.Contents) {
        if (obj.Key) yield obj.Key;
      }
    }

    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

/** Shared temp directory for multer uploads before they're moved to S3 */
export const tempDir = path.join(__dirname, "../../.tmp-uploads");
