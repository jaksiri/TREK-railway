import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LegacyS3Driver } from '../../../../src/nest/storage/drivers/legacy-s3.driver';
import { LocalDriver } from '../../../../src/nest/storage/drivers/local.driver';
import type { S3Api } from '../../../../src/nest/storage/drivers/s3.driver';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-legacy-s3-'));
  dirs.push(root);
  const local = new LocalDriver({ id: 'local', root });
  local.init({ ensurePrefixes: ['journey/'], cleanSpool: false });
  const missing = Object.assign(new Error('not found'), { statusCode: 404 });
  const api = {
    PutObject: vi.fn().mockResolvedValue({}),
    Upload: vi.fn().mockResolvedValue({}),
    HeadObject: vi.fn().mockRejectedValue(missing),
    GetObject: vi.fn().mockRejectedValue(missing),
    DeleteObject: vi.fn().mockResolvedValue({}),
    ListObjectsV2: vi.fn().mockResolvedValue((async function* () { yield { Contents: [] }; })()),
  } satisfies S3Api;
  const driver = new LegacyS3Driver({
    id: 'fork-s3', endpoint: 'https://s3.example.com', bucket: 'trek',
    region: 'us-east-1', keyPrefix: '', accessKeyId: 'test', secretAccessKey: 'test',
    retries: 0, timeoutMs: 1000, clientFactory: async () => api,
  }, local);
  return { driver, local, api, root };
}

async function contents(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe('legacy S3 uploads', () => {
  it('uses S3 before a stale local copy and preserves the object key and Range', async () => {
    const { driver, local, api } = setup();
    await local.put('journey/video.mp4', Readable.from('old'));
    api.GetObject.mockResolvedValue({ Body: Readable.from('new'), ContentLength: 3, ContentRange: 'bytes 2-4/8' });
    api.HeadObject.mockResolvedValue({ ContentLength: 8 });
    expect((await driver.stat('journey/video.mp4'))?.size).toBe(8);
    const result = await driver.getStream('journey/video.mp4', { start: 2, end: 4 });
    expect(await contents(result.stream)).toBe('new');
    expect(api.GetObject).toHaveBeenCalledWith(expect.objectContaining({ Key: 'journey/video.mp4', Range: 'bytes=2-4' }));
  });

  it('serves a local-only file with the requested byte range', async () => {
    const { driver, local } = setup();
    await local.put('journey/video.mp4', Readable.from('abcdef'));
    expect((await driver.stat('journey/video.mp4'))?.size).toBe(6);
    const result = await driver.getStream('journey/video.mp4', { start: 1, end: 3 });
    expect(await contents(result.stream)).toBe('bcd');
    expect(result.stat.size).toBe(6);
  });

  it('falls back on an S3 outage, but surfaces the failure when no local file exists', async () => {
    const { driver, local, api } = setup();
    api.HeadObject.mockRejectedValue(new Error('offline'));
    api.GetObject.mockRejectedValue(new Error('offline'));
    await local.put('journey/local.jpg', Readable.from('image'));
    expect((await driver.stat('journey/local.jpg'))?.size).toBe(5);
    expect(await contents((await driver.getStream('journey/local.jpg')).stream)).toBe('image');
    await expect(driver.stat('journey/missing.jpg')).rejects.toThrow();
    await expect(driver.getStream('journey/missing.jpg')).rejects.toThrow();
  });

  it('uploads to S3 without leaving a local replica', async () => {
    const { driver, local, api, root } = setup();
    const tmpPath = path.join(root, 'spooled');
    fs.writeFileSync(tmpPath, 'new image');
    await driver.put('journey/new.jpg', { tmpPath });
    expect(api.PutObject).toHaveBeenCalledWith(expect.objectContaining({ Key: 'journey/new.jpg', Bucket: 'trek' }));
    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(await local.stat('journey/new.jpg')).toBeNull();
  });

  it('removes local copies even when best-effort S3 deletion fails', async () => {
    const { driver, local, api } = setup();
    await local.put('journey/old.jpg', Readable.from('old'));
    api.DeleteObject.mockRejectedValue(new Error('offline'));
    await driver.delete('journey/old.jpg');
    expect(api.DeleteObject).toHaveBeenCalledWith({ Bucket: 'trek', Key: 'journey/old.jpg' });
    expect(await local.stat('journey/old.jpg')).toBeNull();
  });

  it('lists local-only objects for backups without duplicating S3 keys', async () => {
    const { driver, local, api } = setup();
    await local.put('journey/both.jpg', Readable.from('old'));
    await local.put('journey/local.jpg', Readable.from('local'));
    api.ListObjectsV2.mockResolvedValue((async function* () {
      yield { Contents: [{ Key: 'journey/both.jpg', Size: 10 }] };
    })());
    const objects = [];
    for await (const stat of driver.list('journey/')) objects.push(stat);
    expect(objects.map(s => s.key).sort()).toEqual(['journey/both.jpg', 'journey/local.jpg']);
    expect(objects.find(s => s.key === 'journey/both.jpg')?.size).toBe(10);
  });
});
