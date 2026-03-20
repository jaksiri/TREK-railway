const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate, adminOnly);

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at, last_login FROM users ORDER BY created_at DESC'
  ).all();
  // Add online status from WebSocket connections
  let onlineUserIds = new Set();
  try {
    const { getOnlineUserIds } = require('../websocket');
    onlineUserIds = getOnlineUserIds();
  } catch { /* */ }
  const usersWithStatus = users.map(u => ({ ...u, online: onlineUserIds.has(u.id) }));
  res.json({ users: usersWithStatus });
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username?.trim() || !email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Benutzername, E-Mail und Passwort sind erforderlich' });
  }

  if (role && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Ungültige Rolle' });
  }

  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existingUsername) return res.status(409).json({ error: 'Benutzername bereits vergeben' });

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (existingEmail) return res.status(409).json({ error: 'E-Mail bereits vergeben' });

  const passwordHash = bcrypt.hashSync(password.trim(), 10);

  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username.trim(), email.trim(), passwordHash, role || 'user');

  const user = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.status(201).json({ user });
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const { username, email, role, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  if (role && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Ungültige Rolle' });
  }

  if (username && username !== user.username) {
    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.params.id);
    if (conflict) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
  }
  if (email && email !== user.email) {
    const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.params.id);
    if (conflict) return res.status(409).json({ error: 'E-Mail bereits vergeben' });
  }

  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

  db.prepare(`
    UPDATE users SET
      username = COALESCE(?, username),
      email = COALESCE(?, email),
      role = COALESCE(?, role),
      password_hash = COALESCE(?, password_hash),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(username || null, email || null, role || null, passwordHash, req.params.id);

  const updated = db.prepare(
    'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?'
  ).get(req.params.id);

  res.json({ user: updated });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Eigenes Konto kann nicht gelöscht werden' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalTrips = db.prepare('SELECT COUNT(*) as count FROM trips').get().count;
  const totalPlaces = db.prepare('SELECT COUNT(*) as count FROM places').get().count;
  const totalFiles = db.prepare('SELECT COUNT(*) as count FROM trip_files').get().count;

  res.json({ totalUsers, totalTrips, totalPlaces, totalFiles });
});

// GET /api/admin/oidc — get OIDC config
router.get('/oidc', (req, res) => {
  const get = (key) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value || '';
  res.json({
    issuer: get('oidc_issuer'),
    client_id: get('oidc_client_id'),
    client_secret: get('oidc_client_secret'),
    display_name: get('oidc_display_name'),
  });
});

// PUT /api/admin/oidc — update OIDC config
router.put('/oidc', (req, res) => {
  const { issuer, client_id, client_secret, display_name } = req.body;
  const set = (key, val) => db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, val || '');
  set('oidc_issuer', issuer);
  set('oidc_client_id', client_id);
  set('oidc_client_secret', client_secret);
  set('oidc_display_name', display_name);
  res.json({ success: true });
});

// POST /api/admin/save-demo-baseline (demo mode only)
router.post('/save-demo-baseline', (req, res) => {
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { saveBaseline } = require('../demo/demo-reset');
    saveBaseline();
    res.json({ success: true, message: 'Demo baseline saved. Hourly resets will restore to this state.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save baseline: ' + err.message });
  }
});

// ── Addons ─────────────────────────────────────────────────

router.get('/addons', (req, res) => {
  const addons = db.prepare('SELECT * FROM addons ORDER BY sort_order, id').all();
  res.json({ addons: addons.map(a => ({ ...a, enabled: !!a.enabled, config: JSON.parse(a.config || '{}') })) });
});

router.put('/addons/:id', (req, res) => {
  const addon = db.prepare('SELECT * FROM addons WHERE id = ?').get(req.params.id);
  if (!addon) return res.status(404).json({ error: 'Addon not found' });
  const { enabled, config } = req.body;
  if (enabled !== undefined) db.prepare('UPDATE addons SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  if (config !== undefined) db.prepare('UPDATE addons SET config = ? WHERE id = ?').run(JSON.stringify(config), req.params.id);
  const updated = db.prepare('SELECT * FROM addons WHERE id = ?').get(req.params.id);
  res.json({ addon: { ...updated, enabled: !!updated.enabled, config: JSON.parse(updated.config || '{}') } });
});

module.exports = router;
