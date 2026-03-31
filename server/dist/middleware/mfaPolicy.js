"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceGlobalMfaPolicy = enforceGlobalMfaPolicy;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("../db/database");
const config_1 = require("../config");
/** Paths that never require MFA (public or pre-auth). */
function isPublicApiPath(method, pathNoQuery) {
    if (method === 'GET' && pathNoQuery === '/api/health')
        return true;
    if (method === 'GET' && pathNoQuery === '/api/auth/app-config')
        return true;
    if (method === 'POST' && pathNoQuery === '/api/auth/login')
        return true;
    if (method === 'POST' && pathNoQuery === '/api/auth/register')
        return true;
    if (method === 'POST' && pathNoQuery === '/api/auth/demo-login')
        return true;
    if (method === 'GET' && pathNoQuery.startsWith('/api/auth/invite/'))
        return true;
    if (method === 'POST' && pathNoQuery === '/api/auth/mfa/verify-login')
        return true;
    if (pathNoQuery.startsWith('/api/auth/oidc/'))
        return true;
    return false;
}
/** Authenticated paths allowed while MFA is not yet enabled (setup + lockout recovery). */
function isMfaSetupExemptPath(method, pathNoQuery) {
    if (method === 'GET' && pathNoQuery === '/api/auth/me')
        return true;
    if (method === 'POST' && pathNoQuery === '/api/auth/mfa/setup')
        return true;
    if (method === 'POST' && pathNoQuery === '/api/auth/mfa/enable')
        return true;
    if ((method === 'GET' || method === 'PUT') && pathNoQuery === '/api/auth/app-settings')
        return true;
    return false;
}
/**
 * When app_settings.require_mfa is true, block API access for users without MFA enabled,
 * except for public routes and MFA setup endpoints.
 */
function enforceGlobalMfaPolicy(req, res, next) {
    const pathNoQuery = (req.originalUrl || req.url || '').split('?')[0];
    if (!pathNoQuery.startsWith('/api')) {
        next();
        return;
    }
    if (isPublicApiPath(req.method, pathNoQuery)) {
        next();
        return;
    }
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        next();
        return;
    }
    let userId;
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.JWT_SECRET);
        userId = decoded.id;
    }
    catch {
        next();
        return;
    }
    const requireRow = database_1.db.prepare("SELECT value FROM app_settings WHERE key = 'require_mfa'").get();
    if (requireRow?.value !== 'true') {
        next();
        return;
    }
    if (process.env.DEMO_MODE === 'true') {
        const demo = database_1.db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
        if (demo?.email === 'demo@trek.app' || demo?.email === 'demo@nomad.app') {
            next();
            return;
        }
    }
    const row = database_1.db.prepare('SELECT mfa_enabled, role FROM users WHERE id = ?').get(userId);
    if (!row) {
        next();
        return;
    }
    const mfaOk = row.mfa_enabled === 1 || row.mfa_enabled === true;
    if (mfaOk) {
        next();
        return;
    }
    if (isMfaSetupExemptPath(req.method, pathNoQuery)) {
        next();
        return;
    }
    res.status(403).json({
        error: 'Two-factor authentication is required. Complete setup in Settings.',
        code: 'MFA_REQUIRED',
    });
}
//# sourceMappingURL=mfaPolicy.js.map