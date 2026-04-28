import { NextFunction, Request, Response } from 'express';
import { uploadFile } from '../services/s3';

export function s3Upload(subdir: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) return next();

    try {
      await uploadFile(`${subdir}/${req.file.filename}`, req.file.path, req.file.mimetype);
      next();
    } catch (error) {
      console.error(`[S3] Upload failed for ${subdir}/${req.file.filename}:`, error);
      res.status(500).json({ error: 'File upload failed' });
    }
  };
}
