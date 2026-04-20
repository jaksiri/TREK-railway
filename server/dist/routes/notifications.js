"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const notifications_1 = require("../services/notifications");
const router = express_1.default.Router();
// Get user's notification preferences
router.get('/preferences', auth_1.authenticate, (req, res) => {
    const authReq = req;
    let prefs = database_1.db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(authReq.user.id);
    if (!prefs) {
        database_1.db.prepare('INSERT INTO notification_preferences (user_id) VALUES (?)').run(authReq.user.id);
        prefs = database_1.db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(authReq.user.id);
    }
    res.json({ preferences: prefs });
});
// Update user's notification preferences
router.put('/preferences', auth_1.authenticate, (req, res) => {
    const authReq = req;
    const { notify_trip_invite, notify_booking_change, notify_trip_reminder, notify_webhook } = req.body;
    // Ensure row exists
    const existing = database_1.db.prepare('SELECT id FROM notification_preferences WHERE user_id = ?').get(authReq.user.id);
    if (!existing) {
        database_1.db.prepare('INSERT INTO notification_preferences (user_id) VALUES (?)').run(authReq.user.id);
    }
    database_1.db.prepare(`UPDATE notification_preferences SET
    notify_trip_invite = COALESCE(?, notify_trip_invite),
    notify_booking_change = COALESCE(?, notify_booking_change),
    notify_trip_reminder = COALESCE(?, notify_trip_reminder),
    notify_webhook = COALESCE(?, notify_webhook)
    WHERE user_id = ?`).run(notify_trip_invite !== undefined ? (notify_trip_invite ? 1 : 0) : null, notify_booking_change !== undefined ? (notify_booking_change ? 1 : 0) : null, notify_trip_reminder !== undefined ? (notify_trip_reminder ? 1 : 0) : null, notify_webhook !== undefined ? (notify_webhook ? 1 : 0) : null, authReq.user.id);
    const prefs = database_1.db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(authReq.user.id);
    res.json({ preferences: prefs });
});
// Admin: test SMTP configuration
router.post('/test-smtp', auth_1.authenticate, async (req, res) => {
    const authReq = req;
    if (authReq.user.role !== 'admin')
        return res.status(403).json({ error: 'Admin only' });
    const { email } = req.body;
    const result = await (0, notifications_1.testSmtp)(email || authReq.user.email);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=notifications.js.map