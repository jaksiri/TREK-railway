import { Controller, Get, HttpException, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { FilesService } from './files.service';
import { getFileStream } from '../../services/s3';

/**
 * GET /api/trips/:tripId/files/:id/download — authenticated file download.
 *
 * Deliberately NOT behind the JwtAuthGuard: it accepts a cookie, a Bearer header
 * OR a one-shot `?token=` query param (so links can be opened directly), all via
 * the legacy authenticateDownload helper. Byte-identical to the legacy route:
 * 401 token, 404 trip/file, 403 path traversal, .pkpass served inline for Wallet.
 */
@Controller('api/trips/:tripId/files')
export class FilesDownloadController {
  constructor(private readonly files: FilesService) {}

  @Get(':id/download')
  async download(@Req() req: Request, @Res() res: Response, @Param('tripId') tripId: string, @Param('id') id: string): Promise<void> {
    const auth = this.files.authenticateDownload(req);
    if ('error' in auth) {
      throw new HttpException({ error: auth.error }, auth.status);
    }

    const trip = this.files.verifyTripAccess(tripId, auth.userId);
    if (!trip) {
      throw new HttpException({ error: 'Trip not found' }, 404);
    }

    const file = this.files.getFileById(id, tripId);
    if (!file) {
      throw new HttpException({ error: 'File not found' }, 404);
    }

    // Serve Apple Wallet passes inline with the canonical MIME type so Safari
    // (iOS/macOS) hands them to Wallet instead of downloading as a blob. A
    // `.pkpasses` bundle (a ZIP of multiple passes) is a distinct type with its
    // own plural MIME type — without it Wallet won't offer to add the passes.
    const ext = path.extname(file.original_name || file.filename).toLowerCase();
    const walletMime =
      ext === '.pkpass'
        ? 'application/vnd.apple.pkpass'
        : ext === '.pkpasses'
          ? 'application/vnd.apple.pkpasses'
          : null;

    // Files now live in S3 — stream from there, falling back to any local file
    // still on disk when S3 misses or is not configured.
    const key = file.filename.startsWith('files/') ? file.filename : `files/${file.filename}`;
    try {
      const { stream, contentType, contentLength } = await getFileStream(key);
      if (walletMime) {
        res.setHeader('Content-Type', walletMime);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(file.original_name || file.filename)}"`);
      } else if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      if (contentLength) res.setHeader('Content-Length', String(contentLength));
      stream.pipe(res);
    } catch {
      const { resolved, safe } = this.files.resolveFilePath(file.filename);
      if (!safe) {
        throw new HttpException({ error: 'Forbidden' }, 403);
      }
      if (!fs.existsSync(resolved)) {
        throw new HttpException({ error: 'File not found' }, 404);
      }
      if (walletMime) {
        res.setHeader('Content-Type', walletMime);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(file.original_name || resolved)}"`);
      }
      // Serve with an explicit { root } + basename rather than an absolute path:
      // under the Nest ExpressAdapter, res.sendFile(absolutePath) resolves the
      // file relative to the (rewritten) req.url and fails with a spurious
      // "Not Found". The resolveFilePath guard above pins this to the uploads dir.
      res.sendFile(path.basename(resolved), { root: path.dirname(resolved) });
    }
  }
}
