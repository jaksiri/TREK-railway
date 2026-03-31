"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientIp = getClientIp;
exports.writeAudit = writeAudit;
const database_1 = require("../db/database");
function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
        const first = xff.split(',')[0]?.trim();
        return first || null;
    }
    if (Array.isArray(xff) && xff[0])
        return String(xff[0]).trim() || null;
    return req.socket?.remoteAddress || null;
}
/** Best-effort; never throws — failures are logged only. */
function writeAudit(entry) {
    try {
        const detailsJson = entry.details && Object.keys(entry.details).length > 0 ? JSON.stringify(entry.details) : null;
        database_1.db.prepare(`INSERT INTO audit_log (user_id, action, resource, details, ip) VALUES (?, ?, ?, ?, ?)`).run(entry.userId, entry.action, entry.resource ?? null, detailsJson, entry.ip ?? null);
    }
    catch (e) {
        console.error('[audit] write failed:', e instanceof Error ? e.message : e);
    }
}
//# sourceMappingURL=auditLog.js.map