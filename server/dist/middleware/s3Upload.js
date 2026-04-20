"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.s3Upload = s3Upload;
const s3_1 = require("../services/s3");
/**
 * Post-multer middleware that moves the uploaded temp file to S3.
 * @param subdir - S3 key prefix (e.g. 'files', 'covers', 'avatars')
 */
function s3Upload(subdir) {
    return async (req, res, next) => {
        if (!req.file)
            return next();
        const key = `${subdir}/${req.file.filename}`;
        try {
            await (0, s3_1.uploadFile)(key, req.file.path, req.file.mimetype);
            next();
        }
        catch (err) {
            console.error(`[S3] Upload failed for ${key}:`, err);
            res.status(500).json({ error: 'File upload failed' });
        }
    };
}
//# sourceMappingURL=s3Upload.js.map