"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const websocket_1 = require("../websocket");
const s3_1 = require("../services/s3");
const s3Upload_1 = require("../middleware/s3Upload");
const router = express_1.default.Router();
const MS_PER_DAY = 86400000;
const MAX_TRIP_DAYS = 90;
const MAX_COVER_SIZE = 20 * 1024 * 1024; // 20 MB
const coverStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(s3_1.tempDir))
            fs_1.default.mkdirSync(s3_1.tempDir, { recursive: true });
        cb(null, s3_1.tempDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    },
});
const uploadCover = (0, multer_1.default)({
    storage: coverStorage,
    limits: { fileSize: MAX_COVER_SIZE },
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        if (file.mimetype.startsWith('image/') && !file.mimetype.includes('svg') && allowedExts.includes(ext)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only jpg, png, gif, webp images allowed'));
        }
    },
});
const TRIP_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM days d WHERE d.trip_id = t.id) as day_count,
    (SELECT COUNT(*) FROM places p WHERE p.trip_id = t.id) as place_count,
    CASE WHEN t.user_id = :userId THEN 1 ELSE 0 END as is_owner,
    u.username as owner_username,
    (SELECT COUNT(*) FROM trip_members tm WHERE tm.trip_id = t.id) as shared_count
  FROM trips t
  JOIN users u ON u.id = t.user_id
`;
function generateDays(tripId, startDate, endDate) {
    const existing = database_1.db.prepare('SELECT id, day_number, date FROM days WHERE trip_id = ?').all(tripId);
    if (!startDate || !endDate) {
        const datelessExisting = existing.filter(d => !d.date).sort((a, b) => a.day_number - b.day_number);
        const withDates = existing.filter(d => d.date);
        if (withDates.length > 0) {
            database_1.db.prepare(`DELETE FROM days WHERE trip_id = ? AND date IS NOT NULL`).run(tripId);
        }
        const needed = 7 - datelessExisting.length;
        if (needed > 0) {
            const insert = database_1.db.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, NULL)');
            for (let i = 0; i < needed; i++)
                insert.run(tripId, datelessExisting.length + i + 1);
        }
        else if (needed < 0) {
            const toRemove = datelessExisting.slice(7);
            const del = database_1.db.prepare('DELETE FROM days WHERE id = ?');
            for (const d of toRemove)
                del.run(d.id);
        }
        const remaining = database_1.db.prepare('SELECT id FROM days WHERE trip_id = ? ORDER BY day_number').all(tripId);
        const tmpUpd = database_1.db.prepare('UPDATE days SET day_number = ? WHERE id = ?');
        remaining.forEach((d, i) => tmpUpd.run(-(i + 1), d.id));
        remaining.forEach((d, i) => tmpUpd.run(i + 1, d.id));
        return;
    }
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    const numDays = Math.min(Math.floor((endMs - startMs) / MS_PER_DAY) + 1, MAX_TRIP_DAYS);
    const targetDates = [];
    for (let i = 0; i < numDays; i++) {
        const d = new Date(startMs + i * MS_PER_DAY);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        targetDates.push(`${yyyy}-${mm}-${dd}`);
    }
    const existingByDate = new Map();
    for (const d of existing) {
        if (d.date)
            existingByDate.set(d.date, d);
    }
    const targetDateSet = new Set(targetDates);
    const toDelete = existing.filter(d => d.date && !targetDateSet.has(d.date));
    const datelessToDelete = existing.filter(d => !d.date);
    const del = database_1.db.prepare('DELETE FROM days WHERE id = ?');
    for (const d of [...toDelete, ...datelessToDelete])
        del.run(d.id);
    const setTemp = database_1.db.prepare('UPDATE days SET day_number = ? WHERE id = ?');
    const kept = existing.filter(d => d.date && targetDateSet.has(d.date));
    for (let i = 0; i < kept.length; i++)
        setTemp.run(-(i + 1), kept[i].id);
    const insert = database_1.db.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, ?)');
    const update = database_1.db.prepare('UPDATE days SET day_number = ? WHERE id = ?');
    for (let i = 0; i < targetDates.length; i++) {
        const date = targetDates[i];
        const ex = existingByDate.get(date);
        if (ex) {
            update.run(i + 1, ex.id);
        }
        else {
            insert.run(tripId, i + 1, date);
        }
    }
}
router.get('/', auth_1.authenticate, (req, res) => {
    const authReq = req;
    const archived = req.query.archived === '1' ? 1 : 0;
    const userId = authReq.user.id;
    const trips = database_1.db.prepare(`
    ${TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE (t.user_id = :userId OR m.user_id IS NOT NULL) AND t.is_archived = :archived
    ORDER BY t.created_at DESC
  `).all({ userId, archived });
    res.json({ trips });
});
router.post('/', auth_1.authenticate, (req, res) => {
    const authReq = req;
    const { title, description, start_date, end_date, currency } = req.body;
    if (!title)
        return res.status(400).json({ error: 'Title is required' });
    if (start_date && end_date && new Date(end_date) < new Date(start_date))
        return res.status(400).json({ error: 'End date must be after start date' });
    const result = database_1.db.prepare(`
    INSERT INTO trips (user_id, title, description, start_date, end_date, currency)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(authReq.user.id, title, description || null, start_date || null, end_date || null, currency || 'EUR');
    const tripId = result.lastInsertRowid;
    generateDays(tripId, start_date, end_date);
    const trip = database_1.db.prepare(`${TRIP_SELECT} WHERE t.id = :tripId`).get({ userId: authReq.user.id, tripId });
    res.status(201).json({ trip });
});
router.get('/:id', auth_1.authenticate, (req, res) => {
    const authReq = req;
    const userId = authReq.user.id;
    const trip = database_1.db.prepare(`
    ${TRIP_SELECT}
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = :userId
    WHERE t.id = :tripId AND (t.user_id = :userId OR m.user_id IS NOT NULL)
  `).get({ userId, tripId: req.params.id });
    if (!trip)
        return res.status(404).json({ error: 'Trip not found' });
    res.json({ trip });
});
router.put('/:id', auth_1.authenticate, (req, res) => {
    const authReq = req;
    const access = (0, database_1.canAccessTrip)(req.params.id, authReq.user.id);
    if (!access)
        return res.status(404).json({ error: 'Trip not found' });
    const ownerOnly = req.body.is_archived !== undefined || req.body.cover_image !== undefined;
    if (ownerOnly && !(0, database_1.isOwner)(req.params.id, authReq.user.id))
        return res.status(403).json({ error: 'Only the owner can change this setting' });
    const trip = database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!trip)
        return res.status(404).json({ error: 'Trip not found' });
    const { title, description, start_date, end_date, currency, is_archived, cover_image } = req.body;
    if (start_date && end_date && new Date(end_date) < new Date(start_date))
        return res.status(400).json({ error: 'End date must be after start date' });
    const newTitle = title || trip.title;
    const newDesc = description !== undefined ? description : trip.description;
    const newStart = start_date !== undefined ? start_date : trip.start_date;
    const newEnd = end_date !== undefined ? end_date : trip.end_date;
    const newCurrency = currency || trip.currency;
    const newArchived = is_archived !== undefined ? (is_archived ? 1 : 0) : trip.is_archived;
    const newCover = cover_image !== undefined ? cover_image : trip.cover_image;
    database_1.db.prepare(`
    UPDATE trips SET title=?, description=?, start_date=?, end_date=?,
      currency=?, is_archived=?, cover_image=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(newTitle, newDesc, newStart || null, newEnd || null, newCurrency, newArchived, newCover, req.params.id);
    if (newStart !== trip.start_date || newEnd !== trip.end_date)
        generateDays(req.params.id, newStart, newEnd);
    const updatedTrip = database_1.db.prepare(`${TRIP_SELECT} WHERE t.id = :tripId`).get({ userId: authReq.user.id, tripId: req.params.id });
    res.json({ trip: updatedTrip });
    (0, websocket_1.broadcast)(req.params.id, 'trip:updated', { trip: updatedTrip }, req.headers['x-socket-id']);
});
router.post('/:id/cover', auth_1.authenticate, auth_1.demoUploadBlock, uploadCover.single('cover'), (0, s3Upload_1.s3Upload)('covers'), async (req, res) => {
    const authReq = req;
    if (!(0, database_1.isOwner)(req.params.id, authReq.user.id))
        return res.status(403).json({ error: 'Only the owner can change the cover image' });
    const trip = database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!trip)
        return res.status(404).json({ error: 'Trip not found' });
    if (!req.file)
        return res.status(400).json({ error: 'No image uploaded' });
    if (trip.cover_image) {
        const oldKey = trip.cover_image.replace(/^\/uploads\//, '');
        await (0, s3_1.deleteFile)(oldKey);
    }
    const coverUrl = `/uploads/covers/${req.file.filename}`;
    database_1.db.prepare('UPDATE trips SET cover_image=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(coverUrl, req.params.id);
    res.json({ cover_image: coverUrl });
});
router.delete('/:id', auth_1.authenticate, (req, res) => {
    const authReq = req;
    if (!(0, database_1.isOwner)(req.params.id, authReq.user.id))
        return res.status(403).json({ error: 'Only the owner can delete the trip' });
    const deletedTripId = Number(req.params.id);
    database_1.db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.id);
    res.json({ success: true });
    (0, websocket_1.broadcast)(deletedTripId, 'trip:deleted', { id: deletedTripId }, req.headers['x-socket-id']);
});
router.get('/:id/members', auth_1.authenticate, (req, res) => {
    const authReq = req;
    if (!(0, database_1.canAccessTrip)(req.params.id, authReq.user.id))
        return res.status(404).json({ error: 'Trip not found' });
    const trip = database_1.db.prepare('SELECT user_id FROM trips WHERE id = ?').get(req.params.id);
    const members = database_1.db.prepare(`
    SELECT u.id, u.username, u.email, u.avatar,
      CASE WHEN u.id = ? THEN 'owner' ELSE 'member' END as role,
      m.added_at,
      ib.username as invited_by_username
    FROM trip_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN users ib ON ib.id = m.invited_by
    WHERE m.trip_id = ?
    ORDER BY m.added_at ASC
  `).all(trip.user_id, req.params.id);
    const owner = database_1.db.prepare('SELECT id, username, email, avatar FROM users WHERE id = ?').get(trip.user_id);
    res.json({
        owner: { ...owner, role: 'owner', avatar_url: owner.avatar ? `/uploads/avatars/${owner.avatar}` : null },
        members: members.map(m => ({ ...m, avatar_url: m.avatar ? `/uploads/avatars/${m.avatar}` : null })),
        current_user_id: authReq.user.id,
    });
});
router.post('/:id/members', auth_1.authenticate, (req, res) => {
    const authReq = req;
    if (!(0, database_1.canAccessTrip)(req.params.id, authReq.user.id))
        return res.status(404).json({ error: 'Trip not found' });
    const { identifier } = req.body;
    if (!identifier)
        return res.status(400).json({ error: 'Email or username required' });
    const target = database_1.db.prepare('SELECT id, username, email, avatar FROM users WHERE email = ? OR username = ?').get(identifier.trim(), identifier.trim());
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    const trip = database_1.db.prepare('SELECT user_id FROM trips WHERE id = ?').get(req.params.id);
    if (target.id === trip.user_id)
        return res.status(400).json({ error: 'Trip owner is already a member' });
    const existing = database_1.db.prepare('SELECT id FROM trip_members WHERE trip_id = ? AND user_id = ?').get(req.params.id, target.id);
    if (existing)
        return res.status(400).json({ error: 'User already has access' });
    database_1.db.prepare('INSERT INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)').run(req.params.id, target.id, authReq.user.id);
    // Notify invited user
    const tripInfo = database_1.db.prepare('SELECT title FROM trips WHERE id = ?').get(req.params.id);
    Promise.resolve().then(() => __importStar(require('../services/notifications'))).then(({ notify }) => {
        notify({ userId: target.id, event: 'trip_invite', params: { trip: tripInfo?.title || 'Untitled', actor: authReq.user.username } }).catch(() => { });
    });
    res.status(201).json({ member: { ...target, role: 'member', avatar_url: target.avatar ? `/uploads/avatars/${target.avatar}` : null } });
});
router.delete('/:id/members/:userId', auth_1.authenticate, (req, res) => {
    const authReq = req;
    if (!(0, database_1.canAccessTrip)(req.params.id, authReq.user.id))
        return res.status(404).json({ error: 'Trip not found' });
    const targetId = parseInt(req.params.userId);
    const isSelf = targetId === authReq.user.id;
    if (!isSelf && !(0, database_1.isOwner)(req.params.id, authReq.user.id))
        return res.status(403).json({ error: 'No permission' });
    database_1.db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(req.params.id, targetId);
    res.json({ success: true });
});
// ICS calendar export
router.get('/:id/export.ics', auth_1.authenticate, (req, res) => {
    const authReq = req;
    if (!(0, database_1.canAccessTrip)(req.params.id, authReq.user.id))
        return res.status(404).json({ error: 'Trip not found' });
    const trip = database_1.db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!trip)
        return res.status(404).json({ error: 'Trip not found' });
    const days = database_1.db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number ASC').all(req.params.id);
    const reservations = database_1.db.prepare('SELECT * FROM reservations WHERE trip_id = ?').all(req.params.id);
    const esc = (s) => s.replace(/[\\;,\n]/g, m => m === '\n' ? '\\n' : '\\' + m);
    const fmtDate = (d) => d.replace(/-/g, '');
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = (id, type) => `trek-${type}-${id}@trek`;
    // Format datetime: handles full ISO "2026-03-30T09:00" and time-only "10:00"
    const fmtDateTime = (d, refDate) => {
        if (d.includes('T'))
            return d.replace(/[-:]/g, '').split('.')[0];
        // Time-only: combine with reference date
        if (refDate && d.match(/^\d{2}:\d{2}/)) {
            const datePart = refDate.split('T')[0];
            return `${datePart}T${d.replace(/:/g, '')}00`.replace(/-/g, '');
        }
        return d.replace(/[-:]/g, '');
    };
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TREK//Travel Planner//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n';
    ics += `X-WR-CALNAME:${esc(trip.title || 'TREK Trip')}\r\n`;
    // Trip as all-day event
    if (trip.start_date && trip.end_date) {
        const endNext = new Date(trip.end_date + 'T00:00:00');
        endNext.setDate(endNext.getDate() + 1);
        const endStr = endNext.toISOString().split('T')[0].replace(/-/g, '');
        ics += `BEGIN:VEVENT\r\nUID:${uid(trip.id, 'trip')}\r\nDTSTAMP:${now}\r\nDTSTART;VALUE=DATE:${fmtDate(trip.start_date)}\r\nDTEND;VALUE=DATE:${endStr}\r\nSUMMARY:${esc(trip.title || 'Trip')}\r\n`;
        if (trip.description)
            ics += `DESCRIPTION:${esc(trip.description)}\r\n`;
        ics += `END:VEVENT\r\n`;
    }
    // Reservations as events
    for (const r of reservations) {
        if (!r.reservation_time)
            continue;
        const hasTime = r.reservation_time.includes('T');
        const meta = r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {};
        ics += `BEGIN:VEVENT\r\nUID:${uid(r.id, 'res')}\r\nDTSTAMP:${now}\r\n`;
        if (hasTime) {
            ics += `DTSTART:${fmtDateTime(r.reservation_time)}\r\n`;
            if (r.reservation_end_time) {
                const endDt = fmtDateTime(r.reservation_end_time, r.reservation_time);
                if (endDt.length >= 15)
                    ics += `DTEND:${endDt}\r\n`;
            }
        }
        else {
            ics += `DTSTART;VALUE=DATE:${fmtDate(r.reservation_time)}\r\n`;
        }
        ics += `SUMMARY:${esc(r.title)}\r\n`;
        let desc = r.type ? `Type: ${r.type}` : '';
        if (r.confirmation_number)
            desc += `\\nConfirmation: ${r.confirmation_number}`;
        if (meta.airline)
            desc += `\\nAirline: ${meta.airline}`;
        if (meta.flight_number)
            desc += `\\nFlight: ${meta.flight_number}`;
        if (meta.departure_airport)
            desc += `\\nFrom: ${meta.departure_airport}`;
        if (meta.arrival_airport)
            desc += `\\nTo: ${meta.arrival_airport}`;
        if (meta.train_number)
            desc += `\\nTrain: ${meta.train_number}`;
        if (r.notes)
            desc += `\\n${r.notes}`;
        if (desc)
            ics += `DESCRIPTION:${desc}\r\n`;
        if (r.location)
            ics += `LOCATION:${esc(r.location)}\r\n`;
        ics += `END:VEVENT\r\n`;
    }
    ics += 'END:VCALENDAR\r\n';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${esc(trip.title || 'trek-trip')}.ics"`);
    res.send(ics);
});
exports.default = router;
//# sourceMappingURL=trips.js.map