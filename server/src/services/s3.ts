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
  key: string
): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
  if (!isS3Configured) throw new Error('S3 is not configured');

  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    stream: response.Body as Readable,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
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
