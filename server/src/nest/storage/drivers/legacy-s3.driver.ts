import type { Readable } from 'node:stream';
import { S3Driver, type S3DriverOptions } from './s3.driver';
import { assertValidKey } from '../storage-keys';
import type { ByteRange, ObjectStat, StorageDriver } from '../storage.types';

/**
 * Compatibility for the fork's AWS_* configuration and existing object keys.
 * Uploads use upstream's S3 implementation; old local files remain readable.
 * Do not expose a local fast path: an S3 object must win over a stale disk copy.
 */
export class LegacyS3Driver extends S3Driver {
  constructor(options: S3DriverOptions, private readonly local: StorageDriver) {
    super(options);
  }

  override async getStream(key: string, range?: ByteRange): Promise<{ stream: Readable; stat: ObjectStat }> {
    assertValidKey(key);
    try {
      return await super.getStream(key, range);
    } catch (err) {
      if (await this.local.stat(key)) return this.local.getStream(key, range);
      throw err;
    }
  }

  override async stat(key: string): Promise<ObjectStat | null> {
    assertValidKey(key);
    try {
      return (await super.stat(key)) ?? this.local.stat(key);
    } catch (err) {
      const local = await this.local.stat(key);
      if (local) return local;
      throw err;
    }
  }

  override async delete(key: string): Promise<void> {
    assertValidKey(key);
    // Preserve the fork's best-effort remote deletion, then remove disk copies.
    await super.delete(key).catch(() => {});
    await this.local.delete(key);
  }

  override async *list(prefix: string): AsyncIterable<ObjectStat> {
    const seen = new Set<string>();
    for await (const stat of super.list(prefix)) {
      seen.add(stat.key);
      yield stat;
    }
    for await (const stat of this.local.list(prefix)) {
      if (!seen.has(stat.key)) yield stat;
    }
  }
}
