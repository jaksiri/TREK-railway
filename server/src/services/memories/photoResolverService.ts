import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../../db/database';
import type { TrekPhoto } from '../../types';
import { streamImmichAsset, fetchImmichThumbnailBytes, getAssetInfo as getImmichAssetInfo } from './immichService';
import { streamSynologyAsset, fetchSynologyThumbnailBytes, getSynologyAssetInfo } from './synologyService';
import type { ServiceResult, AssetInfo } from './helpersService';
import { fail, success } from './helpersService';
import { encrypt_api_key, decrypt_api_key } from '../apiKeyCrypto';
import * as photoCache from './trekPhotoCache';
import { ensureLocalThumbnail } from './thumbnailService';
import { isS3Configured, getFileStream, uploadFile } from '../s3';

// Stream an S3 object to the response, honouring Range (206 + Content-Range) when
// asked. Returns false (headers untouched) on any miss so the caller can fall back
// to a local file. Never throws.
async function serveFromS3(res: Response, key: string, cacheControl: string, range?: string): Promise<boolean> {
  try {
    const { stream, contentType, contentLength, contentRange, acceptRanges, statusCode } = await getFileStream(key, range);
    res.status(statusCode);
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
    return true;
  } catch {
    return false;
  }
}

// Pull an S3 object down to a local path (used so Jimp can read an original that
// only lives in S3 when generating a thumbnail). Returns false on any failure.
async function downloadFromS3(key: string, destAbs: string): Promise<boolean> {
  try {
    const { stream } = await getFileStream(key);
    await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destAbs);
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      stream.pipe(out);
    });
    return true;
  } catch {
    return false;
  }
}

// ── Lookup / Register ────────────────────────────────────────────────────

export function getOrCreateTrekPhoto(
  provider: string,
  assetId: string,
  ownerId: number,
  passphrase?: string,
  mediaType: string = 'image',
): number {
  const existing = db.prepare(
    'SELECT id FROM trek_photos WHERE provider = ? AND asset_id = ? AND owner_id = ?'
  ).get(provider, assetId, ownerId) as { id: number } | undefined;
  if (existing) {
    if (passphrase) {
      db.prepare('UPDATE trek_photos SET passphrase = ? WHERE id = ?')
        .run(encrypt_api_key(passphrase), existing.id);
    }
    return existing.id;
  }

  const res = db.prepare(
    'INSERT INTO trek_photos (provider, asset_id, owner_id, passphrase, media_type) VALUES (?, ?, ?, ?, ?)'
  ).run(provider, assetId, ownerId, passphrase ? encrypt_api_key(passphrase) : null, mediaType);
  return Number(res.lastInsertRowid);
}

export function getOrCreateLocalTrekPhoto(
  filePath: string,
  thumbnailPath?: string | null,
  width?: number | null,
  height?: number | null,
  mediaType: string = 'image',
  durationMs?: number | null,
): number {
  const existing = db.prepare(
    "SELECT id FROM trek_photos WHERE provider = 'local' AND file_path = ?"
  ).get(filePath) as { id: number } | undefined;
  if (existing) return existing.id;

  const res = db.prepare(
    'INSERT INTO trek_photos (provider, file_path, thumbnail_path, width, height, media_type, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('local', filePath, thumbnailPath || null, width || null, height || null, mediaType, durationMs ?? null);
  return Number(res.lastInsertRowid);
}

export function resolveTrekPhoto(photoId: number): TrekPhoto | null {
  return db.prepare('SELECT * FROM trek_photos WHERE id = ?').get(photoId) as TrekPhoto | undefined || null;
}

// ── Streaming ────────────────────────────────────────────────────────────

async function streamCachedThumbnail(
  res: Response,
  photo: TrekPhoto,
  fetchBytes: () => Promise<{ bytes: Buffer; contentType: string } | { error: string; status: number }>,
  fallback: () => Promise<unknown>,
): Promise<void> {
  const key = photoCache.cacheKey(photo.provider!, photo.asset_id!, 'thumbnail', photo.owner_id!);

  if (photoCache.serveFresh(res, key)) return;

  const existing = photoCache.getInFlight(key);
  if (existing) {
    const bytes = await existing;
    if (bytes && photoCache.serveFresh(res, key)) return;
    await fallback();
    return;
  }

  const promise = fetchBytes().then(async result => {
    if ('error' in result) return null;
    await photoCache.put(key, result.bytes, result.contentType);
    return result.bytes;
  });
  photoCache.setInFlight(key, promise);

  const bytes = await promise;
  if (bytes && photoCache.serveFresh(res, key)) return;
  await fallback();
}

export async function streamPhoto(
  res: Response,
  userId: number,
  photoId: number,
  kind: 'thumbnail' | 'original',
  range?: string,
): Promise<void> {
  const photo = resolveTrekPhoto(photoId);
  if (!photo) {
    res.status(404).json({ error: 'Photo not found' });
    return;
  }

  if (photo.file_path) {
    const uploadsRoot = path.join(__dirname, '../../../uploads');

    if (kind === 'thumbnail') {
      const isVideo = photo.media_type === 'video';
      let thumbRel = photo.thumbnail_path ?? null;
      // Only raster images get a lazily-generated Jimp thumbnail; Jimp can't decode
      // video, so a video relies on the poster captured at upload (#823).
      if (!thumbRel && !isVideo) {
        const originalAbs = path.join(uploadsRoot, photo.file_path);
        // Jimp needs the original on local disk. When it lives only in S3
        // (volume-less deploy), pull it down first and drop the temp copy after.
        const hadLocal = fs.existsSync(originalAbs);
        const pulled = !hadLocal && isS3Configured && await downloadFromS3(photo.file_path, originalAbs);
        if (hadLocal || pulled) {
          const result = await ensureLocalThumbnail(uploadsRoot, photo.file_path);
          if (result) {
            thumbRel = result.thumbnailRelPath;
            db.prepare(
              'UPDATE trek_photos SET thumbnail_path = ?, width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE id = ?'
            ).run(thumbRel, result.width, result.height, photo.id);
            // Persist the freshly-generated thumbnail to S3 so it survives.
            if (isS3Configured) {
              try { await uploadFile(thumbRel, path.join(uploadsRoot, thumbRel), 'image/jpeg'); } catch { /* best-effort */ }
            }
          }
          if (pulled) { try { fs.unlinkSync(originalAbs); } catch { /* best-effort */ } }
        }
      }
      if (thumbRel) {
        const thumbAbs = path.join(uploadsRoot, thumbRel);
        if (fs.existsSync(thumbAbs)) {
          res.set('Cache-Control', 'public, max-age=86400, immutable');
          res.set('X-Content-Type-Options', 'nosniff');
          res.sendFile(thumbAbs);
          return;
        }
        if (isS3Configured && await serveFromS3(res, thumbRel, 'public, max-age=86400, immutable')) return;
      }
      // A poster-less video must NOT fall through to streaming the whole file as a
      // "thumbnail"; let the client render its own placeholder instead.
      if (isVideo) {
        res.status(404).json({ error: 'No poster available' });
        return;
      }
      // Images fall through to original if the thumbnail is unavailable.
    }

    const localPath = path.join(uploadsRoot, photo.file_path);
    if (fs.existsSync(localPath)) {
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Content-Type-Options', 'nosniff');
      res.sendFile(localPath);
      return;
    }
    // Original lives only in S3 (volume-less deploy): stream it, honouring Range so
    // video seeking works (206 + Content-Range).
    if (isS3Configured && await serveFromS3(res, photo.file_path, 'public, max-age=86400', range)) return;
  }

  switch (photo.provider) {
    case 'local': {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    case 'immich': {
      if (kind === 'thumbnail') {
        await streamCachedThumbnail(
          res, photo,
          () => fetchImmichThumbnailBytes(userId, photo.asset_id!, photo.owner_id!),
          () => streamImmichAsset(res, userId, photo.asset_id!, kind, photo.owner_id!, { mediaType: photo.media_type }),
        );
        return;
      }
      await streamImmichAsset(res, userId, photo.asset_id!, kind, photo.owner_id!, { mediaType: photo.media_type, range });
      return;
    }
    case 'synologyphotos': {
      const passphrase = photo.passphrase ? (decrypt_api_key(photo.passphrase) || undefined) : undefined;
      if (kind === 'thumbnail') {
        await streamCachedThumbnail(
          res, photo,
          () => fetchSynologyThumbnailBytes(userId, photo.owner_id!, photo.asset_id!, passphrase),
          () => streamSynologyAsset(res, userId, photo.owner_id!, photo.asset_id!, kind, undefined, passphrase),
        );
        return;
      }
      await streamSynologyAsset(res, userId, photo.owner_id!, photo.asset_id!, kind, undefined, passphrase);
      return;
    }
    default:
      res.status(400).json({ error: `Unknown provider: ${photo.provider}` });
  }
}

// ── Asset Info ────────────────────────────────────────────────────────────

export async function getPhotoInfo(
  userId: number,
  photoId: number,
): Promise<ServiceResult<AssetInfo>> {
  const photo = resolveTrekPhoto(photoId);
  if (!photo) return fail('Photo not found', 404);

  switch (photo.provider) {
    case 'local': {
      return success({
        id: String(photo.id),
        takenAt: photo.created_at,
        city: null,
        country: null,
        width: photo.width,
        height: photo.height,
        fileName: photo.file_path?.split('/').pop() || null,
      } as AssetInfo);
    }
    case 'immich': {
      const result = await getImmichAssetInfo(userId, photo.asset_id!, photo.owner_id!);
      if (result.error) return fail(result.error, result.status || 500);
      return success(result.data as AssetInfo);
    }
    case 'synologyphotos': {
      const passphrase = photo.passphrase ? (decrypt_api_key(photo.passphrase) || undefined) : undefined;
      return getSynologyAssetInfo(userId, photo.asset_id!, photo.owner_id!, passphrase);
    }
    default:
      return fail(`Unknown provider: ${photo.provider}`, 400);
  }
}

// ── Update provider on existing trek_photo (for Immich upload sync) ─────

export function setTrekPhotoProvider(
  trekPhotoId: number,
  provider: string,
  assetId: string,
  ownerId: number,
): void {
  db.prepare(
    'UPDATE trek_photos SET provider = ?, asset_id = ?, owner_id = ? WHERE id = ?'
  ).run(provider, assetId, ownerId, trekPhotoId);
}

// ── Orphan cleanup ───────────────────────────────────────────────────────

export function deleteTrekPhotoIfOrphan(photoId: number): void {
  const stillUsed = db.prepare(`
    SELECT 1 FROM trip_photos WHERE photo_id = ?
    UNION ALL
    SELECT 1 FROM journey_photos WHERE photo_id = ?
    LIMIT 1
  `).get(photoId, photoId);
  if (stillUsed) return;
  db.prepare("DELETE FROM trek_photos WHERE id = ? AND provider != 'local'").run(photoId);
}

