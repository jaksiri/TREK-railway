import { Request, Response, NextFunction } from "express";
import { uploadFile } from "../services/s3";

/**
 * Post-multer middleware that moves the uploaded temp file to S3.
 * @param subdir - S3 key prefix (e.g. 'files', 'covers', 'avatars')
 */
export function s3Upload(subdir: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) return next();

    const key = `${subdir}/${req.file.filename}`;
    try {
      await uploadFile(key, req.file.path, req.file.mimetype);
      next();
    } catch (err) {
      console.error(`[S3] Upload failed for ${key}:`, err);
      res.status(500).json({ error: "File upload failed" });
    }
  };
}
