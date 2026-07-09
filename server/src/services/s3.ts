import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const isS3Configured = Boolean(
  process.env.AWS_ENDPOINT_URL &&
  process.env.AWS_S3_BUCKET_NAME &&
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY
);

const bucket = process.env.AWS_S3_BUCKET_NAME || '';

const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL,
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true,
  // AWS SDK v3 (>= 3.729) turns on flexible-checksum integrity by default: it adds
  // `x-amz-checksum-mode=ENABLED` on GetObject and validates a checksum in the
  // response. Non-AWS S3-compatible stores (storageapi.dev/Tigris, R2, MinIO) don't
  // return those checksums, so validation throws and the download 500s even though
  // the object exists. WHEN_REQUIRED restores the pre-3.729 behaviour (only checksum
  // when the operation actually requires it), fixing GET while leaving PUT working.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export async function uploadFile(key: string, filePath: string, contentType?: string): Promise<void> {
  if (!isS3Configured) throw new Error('S3 is not configured');

  const stream = fs.createReadStream(filePath);
  const stat = fs.statSync(filePath);
  const upload = new Upload({
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

  try {
    fs.unlinkSync(filePath);
  } catch {}
}

/**
 * Push a freshly-received multer upload to S3. No-op when S3 is not configured
 * (self-host without object storage keeps the local disk file, which the serving
 * routes fall back to). On success the local temp file is removed by uploadFile.
 */
export async function persistUploadToS3(
  file: { path: string; filename: string; mimetype?: string },
  subdir: string,
): Promise<void> {
  if (!isS3Configured) return;
  await uploadFile(`${subdir}/${file.filename}`, file.path, file.mimetype);
}

export async function uploadStream(key: string, stream: Readable | fs.ReadStream, contentType?: string): Promise<void> {
  if (!isS3Configured) throw new Error('S3 is not configured');

  const upload = new Upload({
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

export async function uploadBuffer(key: string, buffer: Buffer, contentType?: string): Promise<void> {
  if (!isS3Configured) throw new Error('S3 is not configured');

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
}

export async function getFileStream(
  key: string,
  range?: string,
): Promise<{
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
  statusCode: 200 | 206;
}> {
  if (!isS3Configured) throw new Error('S3 is not configured');

  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
  return {
    stream: response.Body as Readable,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    acceptRanges: response.AcceptRanges,
    // S3 answers a satisfiable Range with 206 + Content-Range; otherwise it's a full 200.
    statusCode: response.ContentRange ? 206 : 200,
  };
}

export async function deleteFile(key: string): Promise<void> {
  if (!isS3Configured) return;

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {}
}

export async function* listFiles(prefix: string): AsyncGenerator<string> {
  if (!isS3Configured) return;

  let continuationToken: string | undefined;
  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    }));

    for (const item of response.Contents || []) {
      if (item.Key) yield item.Key;
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
}

export const tempDir = path.join(__dirname, '../../.tmp-uploads');
