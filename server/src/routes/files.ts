import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db, canAccessTrip } from '../db/database';
import { authenticate, demoUploadBlock } from '../middleware/auth';
import { requireTripAccess } from '../middleware/tripAccess';
import { broadcast } from '../websocket';
import { AuthRequest, TripFile } from '../types';

const router = express.Router({ mergeParams: true });

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const filesDir = path.join(__dirname, '../../uploads/files');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
    cb(null, filesDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const DEFAULT_ALLOWED_EXTENSIONS = 'jpg,jpeg,png,gif,webp,heic,pdf,doc,docx,xls,xlsx,txt,csv';
const BLOCKED_EXTENSIONS = ['.svg', '.html', '.htm', '.xml'];

function getAllowedExtensions(): string {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'allowed_file_types'").get() as { value: string } | undefined;
    return row?.value || DEFAULT_ALLOWED_EXTENSIONS;
  } catch { return DEFAULT_ALLOWED_EXTENSIONS; }
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext) || file.mimetype.includes('svg')) {
      return cb(new Error('File type not allowed'));
    }
    const allowed = getAllowedExtensions().split(',').map(e => e.trim().toLowerCase());
    const fileExt = ext.replace('.', '');
    if (allowed.includes(fileExt) || (allowed.includes('*') && !BLOCKED_EXTENSIONS.includes(ext))) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

function verifyTripOwnership(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

const FILE_SELECT = `
  SELECT f.*, r.title as reservation_title, u.username as uploaded_by_name, u.avatar as uploaded_by_avatar
  FROM trip_files f
  LEFT JOIN reservations r ON f.reservation_id = r.id
  LEFT JOIN users u ON f.uploaded_by = u.id
`;

function formatFile(file: TripFile) {
  return {
    ...file,
    url: file.filename?.startsWith('files/') ? `/uploads/${file.filename}` : `/uploads/files/${file.filename}`,
  };
}

// List files (excludes soft-deleted by default)
router.get('/', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const showTrash = req.query.trash === 'true';

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const where = showTrash ? 'f.trip_id = ? AND f.deleted_at IS NOT NULL' : 'f.trip_id = ? AND f.deleted_at IS NULL';
  const files = db.prepare(`${FILE_SELECT} WHERE ${where} ORDER BY f.starred DESC, f.created_at DESC`).all(tripId) as TripFile[];
  res.json({ files: files.map(formatFile) });
});

// Upload file
router.post('/', authenticate, requireTripAccess, demoUploadBlock, upload.single('file'), (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const { place_id, description, reservation_id } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const result = db.prepare(`
    INSERT INTO trip_files (trip_id, place_id, reservation_id, filename, original_name, file_size, mime_type, description, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tripId,
    place_id || null,
    reservation_id || null,
    req.file.filename,
    req.file.originalname,
    req.file.size,
    req.file.mimetype,
    description || null,
    authReq.user.id
  );

  const file = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(result.lastInsertRowid) as TripFile;
  res.status(201).json({ file: formatFile(file) });
  broadcast(tripId, 'file:created', { file: formatFile(file) }, req.headers['x-socket-id'] as string);
});

// Update file metadata
router.put('/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;
  const { description, place_id, reservation_id } = req.body;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const file = db.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ?').get(id, tripId) as TripFile | undefined;
  if (!file) return res.status(404).json({ error: 'File not found' });

  db.prepare(`
    UPDATE trip_files SET
      description = ?,
      place_id = ?,
      reservation_id = ?
    WHERE id = ?
  `).run(
    description !== undefined ? description : file.description,
    place_id !== undefined ? (place_id || null) : file.place_id,
    reservation_id !== undefined ? (reservation_id || null) : file.reservation_id,
    id
  );

  const updated = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(id) as TripFile;
  res.json({ file: formatFile(updated) });
  broadcast(tripId, 'file:updated', { file: formatFile(updated) }, req.headers['x-socket-id'] as string);
});

// Toggle starred
router.patch('/:id/star', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const file = db.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ?').get(id, tripId) as TripFile | undefined;
  if (!file) return res.status(404).json({ error: 'File not found' });

  const newStarred = file.starred ? 0 : 1;
  db.prepare('UPDATE trip_files SET starred = ? WHERE id = ?').run(newStarred, id);

  const updated = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(id) as TripFile;
  res.json({ file: formatFile(updated) });
  broadcast(tripId, 'file:updated', { file: formatFile(updated) }, req.headers['x-socket-id'] as string);
});

// Soft-delete (move to trash)
router.delete('/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const file = db.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ?').get(id, tripId) as TripFile | undefined;
  if (!file) return res.status(404).json({ error: 'File not found' });

  db.prepare('UPDATE trip_files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'file:deleted', { fileId: Number(id) }, req.headers['x-socket-id'] as string);
});

// Restore from trash
router.post('/:id/restore', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const file = db.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ? AND deleted_at IS NOT NULL').get(id, tripId) as TripFile | undefined;
  if (!file) return res.status(404).json({ error: 'File not found in trash' });

  db.prepare('UPDATE trip_files SET deleted_at = NULL WHERE id = ?').run(id);

  const restored = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(id) as TripFile;
  res.json({ file: formatFile(restored) });
  broadcast(tripId, 'file:created', { file: formatFile(restored) }, req.headers['x-socket-id'] as string);
});

// Permanently delete from trash
router.delete('/:id/permanent', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const file = db.prepare('SELECT * FROM trip_files WHERE id = ? AND trip_id = ? AND deleted_at IS NOT NULL').get(id, tripId) as TripFile | undefined;
  if (!file) return res.status(404).json({ error: 'File not found in trash' });

  const filePath = path.join(filesDir, file.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.error('Error deleting file:', e); }
  }

  db.prepare('DELETE FROM trip_files WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'file:deleted', { fileId: Number(id) }, req.headers['x-socket-id'] as string);
});

// Empty entire trash
router.delete('/trash/empty', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const trashed = db.prepare('SELECT * FROM trip_files WHERE trip_id = ? AND deleted_at IS NOT NULL').all(tripId) as TripFile[];
  for (const file of trashed) {
    const filePath = path.join(filesDir, file.filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { console.error('Error deleting file:', e); }
    }
  }

  db.prepare('DELETE FROM trip_files WHERE trip_id = ? AND deleted_at IS NOT NULL').run(tripId);
  res.json({ success: true, deleted: trashed.length });
});

export default router;
