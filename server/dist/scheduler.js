"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALID_INTERVALS = void 0;
exports.start = start;
exports.stop = stop;
exports.startDemoReset = startDemoReset;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
const node_cron_1 = __importDefault(require("node-cron"));
const archiver_1 = __importDefault(require("archiver"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const s3_1 = require("./services/s3");
const dataDir = path_1.default.join(__dirname, '../data');
const backupsDir = path_1.default.join(dataDir, 'backups');
const settingsFile = path_1.default.join(dataDir, 'backup-settings.json');
const VALID_INTERVALS = ['hourly', 'daily', 'weekly', 'monthly'];
exports.VALID_INTERVALS = VALID_INTERVALS;
const VALID_DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6]; // 0=Sunday
const VALID_HOURS = Array.from({ length: 24 }, (_, i) => i);
function buildCronExpression(settings) {
    const hour = VALID_HOURS.includes(settings.hour) ? settings.hour : 2;
    const dow = VALID_DAYS_OF_WEEK.includes(settings.day_of_week) ? settings.day_of_week : 0;
    const dom = settings.day_of_month >= 1 && settings.day_of_month <= 28 ? settings.day_of_month : 1;
    switch (settings.interval) {
        case 'hourly': return '0 * * * *';
        case 'daily': return `0 ${hour} * * *`;
        case 'weekly': return `0 ${hour} * * ${dow}`;
        case 'monthly': return `0 ${hour} ${dom} * *`;
        default: return `0 ${hour} * * *`;
    }
}
let currentTask = null;
function getDefaults() {
    return { enabled: false, interval: 'daily', keep_days: 7, hour: 2, day_of_week: 0, day_of_month: 1 };
}
function loadSettings() {
    let settings = getDefaults();
    try {
        if (fs_1.default.existsSync(settingsFile)) {
            const saved = JSON.parse(fs_1.default.readFileSync(settingsFile, 'utf8'));
            settings = { ...settings, ...saved };
        }
    }
    catch (e) { }
    return settings;
}
function saveSettings(settings) {
    if (!fs_1.default.existsSync(dataDir))
        fs_1.default.mkdirSync(dataDir, { recursive: true });
    fs_1.default.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}
async function runBackup() {
    if (!fs_1.default.existsSync(backupsDir))
        fs_1.default.mkdirSync(backupsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `auto-backup-${timestamp}.zip`;
    const outputPath = path_1.default.join(backupsDir, filename);
    try {
        // Flush WAL to main DB file before archiving
        try {
            const { db } = require('./db/database');
            db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        }
        catch (e) { }
        await new Promise(async (resolve, reject) => {
            const output = fs_1.default.createWriteStream(outputPath);
            const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            const dbPath = path_1.default.join(dataDir, 'travel.db');
            if (fs_1.default.existsSync(dbPath))
                archive.file(dbPath, { name: 'travel.db' });
            // Stream uploads from S3 into the archive
            for await (const key of (0, s3_1.listFiles)('')) {
                const { stream } = await (0, s3_1.getFileStream)(key);
                archive.append(stream, { name: `uploads/${key}` });
            }
            archive.finalize();
        });
        console.log(`[Auto-Backup] Created: ${filename}`);
    }
    catch (err) {
        console.error('[Auto-Backup] Error:', err instanceof Error ? err.message : err);
        if (fs_1.default.existsSync(outputPath))
            fs_1.default.unlinkSync(outputPath);
        return;
    }
    const settings = loadSettings();
    if (settings.keep_days > 0) {
        cleanupOldBackups(settings.keep_days);
    }
}
function cleanupOldBackups(keepDays) {
    try {
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - keepDays * MS_PER_DAY;
        const files = fs_1.default.readdirSync(backupsDir).filter(f => f.endsWith('.zip'));
        for (const file of files) {
            const filePath = path_1.default.join(backupsDir, file);
            const stat = fs_1.default.statSync(filePath);
            if (stat.birthtimeMs < cutoff) {
                fs_1.default.unlinkSync(filePath);
                console.log(`[Auto-Backup] Old backup deleted: ${file}`);
            }
        }
    }
    catch (err) {
        console.error('[Auto-Backup] Cleanup error:', err instanceof Error ? err.message : err);
    }
}
function start() {
    if (currentTask) {
        currentTask.stop();
        currentTask = null;
    }
    const settings = loadSettings();
    if (!settings.enabled) {
        console.log('[Auto-Backup] Disabled');
        return;
    }
    const expression = buildCronExpression(settings);
    const tz = process.env.TZ || 'UTC';
    currentTask = node_cron_1.default.schedule(expression, runBackup, { timezone: tz });
    console.log(`[Auto-Backup] Scheduled: ${settings.interval} (${expression}), tz: ${tz}, retention: ${settings.keep_days === 0 ? 'forever' : settings.keep_days + ' days'}`);
}
// Demo mode: hourly reset of demo user data
let demoTask = null;
function startDemoReset() {
    if (demoTask) {
        demoTask.stop();
        demoTask = null;
    }
    if (process.env.DEMO_MODE !== 'true')
        return;
    demoTask = node_cron_1.default.schedule('0 * * * *', () => {
        try {
            const { resetDemoUser } = require('./demo/demo-reset');
            resetDemoUser();
        }
        catch (err) {
            console.error('[Demo Reset] Error:', err instanceof Error ? err.message : err);
        }
    });
    console.log('[Demo] Hourly reset scheduled (at :00 every hour)');
}
function stop() {
    if (currentTask) {
        currentTask.stop();
        currentTask = null;
    }
    if (demoTask) {
        demoTask.stop();
        demoTask = null;
    }
}
//# sourceMappingURL=scheduler.js.map