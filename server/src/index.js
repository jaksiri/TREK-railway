require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// Create upload directories on startup
const uploadsDir = path.join(__dirname, '../uploads');
const photosDir = path.join(uploadsDir, 'photos');
const filesDir = path.join(uploadsDir, 'files');
const coversDir = path.join(uploadsDir, 'covers');
const backupsDir = path.join(__dirname, '../data/backups');
const tmpDir = path.join(__dirname, '../data/tmp');

[uploadsDir, photosDir, filesDir, coversDir, backupsDir, tmpDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : null;

let corsOrigin;
if (allowedOrigins) {
  // Explicit whitelist from env var
  corsOrigin = (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  };
} else if (process.env.NODE_ENV === 'production') {
  // Production: same-origin only (Express serves the static client)
  corsOrigin = false;
} else {
  // Development: allow all origins (needed for Vite dev server)
  corsOrigin = true;
}

app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
const authRoutes = require('./routes/auth');
const tripsRoutes = require('./routes/trips');
const daysRoutes = require('./routes/days');
const placesRoutes = require('./routes/places');
const assignmentsRoutes = require('./routes/assignments');
const packingRoutes = require('./routes/packing');
const tagsRoutes = require('./routes/tags');
const categoriesRoutes = require('./routes/categories');
const adminRoutes = require('./routes/admin');
const mapsRoutes = require('./routes/maps');
const filesRoutes = require('./routes/files');
const reservationsRoutes = require('./routes/reservations');
const dayNotesRoutes = require('./routes/dayNotes');
const weatherRoutes = require('./routes/weather');
const settingsRoutes = require('./routes/settings');
const budgetRoutes = require('./routes/budget');
const backupRoutes = require('./routes/backup');

const oidcRoutes = require('./routes/oidc');
app.use('/api/auth', authRoutes);
app.use('/api/auth/oidc', oidcRoutes);
app.use('/api/trips', tripsRoutes);
app.use('/api/trips/:tripId/days', daysRoutes);
app.use('/api/trips/:tripId/places', placesRoutes);
app.use('/api/trips/:tripId/packing', packingRoutes);
app.use('/api/trips/:tripId/files', filesRoutes);
app.use('/api/trips/:tripId/budget', budgetRoutes);
app.use('/api/trips/:tripId/reservations', reservationsRoutes);
app.use('/api/trips/:tripId/days/:dayId/notes', dayNotesRoutes);
app.use('/api', assignmentsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/admin', adminRoutes);

// Public addons endpoint (authenticated but not admin-only)
const { authenticate: addonAuth } = require('./middleware/auth');
const { db: addonDb } = require('./db/database');
app.get('/api/addons', addonAuth, (req, res) => {
  const addons = addonDb.prepare('SELECT id, name, type, icon, enabled FROM addons WHERE enabled = 1 ORDER BY sort_order').all();
  res.json({ addons: addons.map(a => ({ ...a, enabled: !!a.enabled })) });
});

// Addon routes
const vacayRoutes = require('./routes/vacay');
app.use('/api/addons/vacay', vacayRoutes);
const atlasRoutes = require('./routes/atlas');
app.use('/api/addons/atlas', atlasRoutes);

app.use('/api/maps', mapsRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.join(__dirname, '../public');
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const scheduler = require('./scheduler');

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`NOMAD API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.DEMO_MODE === 'true') console.log('Demo mode: ENABLED');
  scheduler.start();
  scheduler.startDemoReset();
  const { setupWebSocket } = require('./websocket');
  setupWebSocket(server);
});

module.exports = app;
