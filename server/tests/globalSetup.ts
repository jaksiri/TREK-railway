import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import S3rver from 's3rver';

const TEST_BUCKET = 'trek-test-bucket';
const TEST_REGION = 'us-east-1';
const TEST_ACCESS_KEY = 'S3RVER';
const TEST_SECRET_KEY = 'S3RVER';

async function ensureBucket(endpoint: string) {
  const client = new S3Client({
    endpoint,
    region: TEST_REGION,
    credentials: {
      accessKeyId: TEST_ACCESS_KEY,
      secretAccessKey: TEST_SECRET_KEY,
    },
    forcePathStyle: true,
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  }
}

async function waitForBucket(endpoint: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await ensureBucket(endpoint);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

export default async function globalSetup() {
  if (process.env.TREK_TEST_STORAGE !== 's3') return;

  if (
    process.env.AWS_ENDPOINT_URL &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET_NAME
  ) {
    await waitForBucket(process.env.AWS_ENDPOINT_URL);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trek-s3rver-'));
  const host = '127.0.0.1';
  const port = 4569;
  const endpoint = `http://${host}:${port}`;
  const server = new S3rver({
    address: host,
    port,
    silent: true,
    directory: tempDir,
    configureBuckets: [{ name: TEST_BUCKET }],
  });

  await server.run();

  process.env.AWS_ENDPOINT_URL = endpoint;
  process.env.AWS_DEFAULT_REGION = TEST_REGION;
  process.env.AWS_ACCESS_KEY_ID = TEST_ACCESS_KEY;
  process.env.AWS_SECRET_ACCESS_KEY = TEST_SECRET_KEY;
  process.env.AWS_S3_BUCKET_NAME = TEST_BUCKET;

  await waitForBucket(endpoint);

  return async () => {
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  };
}
