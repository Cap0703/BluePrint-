import 'dotenv/config';
import express from 'express';
import { pool, initializeDatabase } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import session from 'express-session';
import cors from 'cors';
import crypto from 'crypto';
import { get } from 'http';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scannerSockets = new Map();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const CALENDAR_CACHE_FILE = path.join(__dirname, 'cache', 'calendar_cache.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const MASTER_KEY = Buffer.from(process.env.MASTER_KEY, 'hex');
let ATTENDANCE_GRACE_PERIOD_MINUTES = Number(process.env.GRACE_PERIOD_MINUTES || 10);

let settings = { gracePeriodMinutes: ATTENDANCE_GRACE_PERIOD_MINUTES };

const frontendSockets = new Set();

wss.on('connection', (ws, req) => {
  console.log(`[WS] New connection from ${req.socket.remoteAddress}, url: ${req.url}`);
  ws.on('close', (code, reason) => {
    console.log(`[WS] Connection closed. Code: ${code}, Reason: ${reason.toString()}`);
  });
  ws.on('error', (err) => {
    console.error(`[WS] Error:`, err.message);
  });
  let scannerId = null;
  let isFrontend = false;
  ws.on('message', (message) => {
    const data = JSON.parse(message.toString());
    if (data.type === 'auth') {
      scannerId = data.scannerId;
      scannerSockets.set(scannerId, ws);
    }
    if (data.type === 'frontend') {
      isFrontend = true;
      ws.scannerId = data.scannerId;
      frontendSockets.add(ws);
    }
    if (data.type === 'output') {
      console.log(`[SCANNER ${data.scannerId}] ${data.output}`);
      frontendSockets.forEach(client => {
        if (client.readyState === 1 && String(client.scannerId) === String(data.scannerId)) {
          client.send(JSON.stringify({
            type: "output",
            scannerId: data.scannerId,
            output: data.output
          }));
        }
      });
    }
  });
  ws.on('close', () => {
    if (scannerId) scannerSockets.delete(scannerId);
    if (isFrontend) frontendSockets.delete(ws);
  });
});

function loadSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    settings = JSON.parse(data);
    ATTENDANCE_GRACE_PERIOD_MINUTES = settings.gracePeriodMinutes;
  } catch (err) {
    // Use default, and save it
    saveSettings();
  }
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    // Use ipKeyGenerator for correct IPv4/IPv6 handling
    const ip = ipKeyGenerator(req);
    return req.body.email + '_' + ip;
  },
  message: {
    error: 'Too many login attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.static(path.join(__dirname, "public")));



/*----------------------------------------Authentication Middleware----------------------------------------*/
function verifyToken(req, res, next) {
  const token = req.session.user?.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role !== role && req.user.role !== 'administrator') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function redirectIfNotAuthenticated(req, res, next) {
  const token = req.session.user?.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (err) {
    return res.redirect('/login');
  }
}



/*----------------------------------------Calendar Functions----------------------------------------*/
let calendarCache = { data: null, lastUpdated: null, isUpdating: false };

function loadCalendarCache() {
  try {
    if (fs.existsSync(CALENDAR_CACHE_FILE)) {
      console.log(' Calendar cache file exists');
      const cacheData = fs.readFileSync(CALENDAR_CACHE_FILE, 'utf8');
      calendarCache = JSON.parse(cacheData);
      console.log('Loaded calendar cache:', {
        hasData: !!calendarCache.data,
        lastUpdated: calendarCache.lastUpdated,
        eventCount: calendarCache.data?.events?.length || 0
      });
    } else {
      console.log('Calendar cache file does not exist:', CALENDAR_CACHE_FILE);
      calendarCache = { data: null, lastUpdated: null, isUpdating: false };
    }
  } catch (error) {
    console.error("Error loading calendar cache:", error);
    calendarCache = { data: null, lastUpdated: null, isUpdating: false };
  }
}

function saveCalendarCache(data) {
  try {
    calendarCache = {
      data: data,
      lastUpdated: new Date().toISOString(),
      isUpdating: false
    };
    fs.writeFileSync(CALENDAR_CACHE_FILE, JSON.stringify(calendarCache, null, 2));
  } catch (error) {
    console.error("Error saving calendar cache:", error);
  }
}

function shouldUpdateCache() {
  if (!calendarCache.lastUpdated) return true;
  const lastUpdate = new Date(calendarCache.lastUpdated);
  const now = new Date();
  const minutesSinceUpdate = (now - lastUpdate) / (1000 * 60);
  return minutesSinceUpdate >= 10;
}

async function fetchCalendarFromAPI(date = null) {
  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(__dirname, "api/calendar", "fetch_calendar.py");
    if (!fs.existsSync(pythonScriptPath)) {
      console.error('Python script not found at:', pythonScriptPath);
      reject(new Error('Python script not found'));
      return;
    }
    const args = [pythonScriptPath];
    if (date) {
      args.push(date);
    }
    const pythonProcess = spawn('python', args);
    let data = '';
    let error = '';
    pythonProcess.stdout.on('data', (chunk) => {
      data += chunk.toString();
    });
    pythonProcess.stderr.on('data', (chunk) => {
      error += chunk.toString();
      console.error('Python stderr:', chunk.toString());
    });
    pythonProcess.on('close', (code) => {
      //console.log(`Python script exited with code: ${code}`);
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}: ${error}`));
        return;
      }
      try {
        const result = JSON.parse(data);
        if (result.error) {
          reject(new Error(result.error));
        } else {
          //console.log('Successfully parsed calendar data for date:', result.date, 'events:', result.events?.length || 0);
          resolve(result);
        }
      } catch (parseError) {
        console.error('Failed to parse calendar data:', parseError.message);
        console.error('Raw data was:', data);
        reject(new Error(`Failed to parse calendar data: ${parseError.message}`));
      }
    });
    pythonProcess.on('error', (err) => {
      //console.error('Python process failed:', err.message);
      reject(new Error(`Python process failed: ${err.message}`));
    });
  });
}

function getFallbackPeriods() {
  console.log('Using fallback period data for testing');
  return [
    {
      title: "Period 1",
      startTime: "08:00",
      endTime: "09:25"
    },
    {
      title: "Period 2",
      startTime: "09:30",
      endTime: "10:50"
    },
    {
      title: "Period 3",
      startTime: "11:10",
      endTime: "12:30"
    },
    {
      title: "Period 4",
      startTime: "13:05",
      endTime: "14:25"
    }
  ];
}

function extractPeriods(events) {
  if (!Array.isArray(events)) return [];
  const periods = events.filter(event => {
    const title = (event.title || '').toLowerCase();
    return !(title.includes('lunch') || title.includes('break') || title.includes('transition'));
  });
  if (periods.length === 0) return [];
  return periods;
}

async function getPeriodsForDate(dateString) {
  if (
    calendarCache.data &&
    calendarCache.data.date === dateString &&
    !shouldUpdateCache()
  ) {
    const periods = extractPeriods(calendarCache.data.events);
    if (periods.length > 0) {
      return periods;
    }
  }
  try {
    console.log(`fetching calendar for ${dateString}`);
    const data = await fetchCalendarFromAPI(dateString);
    if (data && data.events) {
      saveCalendarCache(data);
      const periods = extractPeriods(data.events);
      if (periods.length > 0) {
        return periods;
      }
    }
  } catch (err) {
    console.error(`failed to retrieve calendar for ${dateString}:`, err);
  }
  return getFallbackPeriods();
}

function getPeriodsToday() {
  const today = new Date().toISOString().split('T')[0];
  return extractPeriods(calendarCache.data?.events) || getFallbackPeriods();
}

loadCalendarCache();



/*----------------------------------------Log Functions----------------------------------------*/

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function extractLogTimeValue(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const parts = normalized.split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : normalized;
}

function normalizeOptionalValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (
    !normalized ||
    normalized.toLowerCase() === 'auto' ||
    normalized.toLowerCase() === 'auto assign' ||
    normalized.toLowerCase() === 'null'
  ) {
    return null;
  }
  return normalized;
}

function assignStatusForLog(log, periods) {
  const normalizedStatus = normalizeOptionalValue(log.status);
  if (!normalizedStatus || normalizedStatus === 'Unknown' || normalizedStatus === 'na') {
    if (!log.period) return null;
    const period = periods.find(p => p.title === log.period);
    if (!period) return null;
    const logTimeStr = extractLogTimeValue(log.time_scanned);
    if (!logTimeStr) return null;
    const scannedMinutes = timeToMinutes(logTimeStr);
    const startMinutes = timeToMinutes(period.startTime);
    if (scannedMinutes === null || startMinutes === null) return null;
    if (scannedMinutes <= startMinutes + ATTENDANCE_GRACE_PERIOD_MINUTES) {
      return 'on-time';
    } else {
      return 'Late';
    }
  }
  return log.status;
}

function assignPeriodForLog(log, periods) {
  //console.log(log.id, 'scanned at', log.time_scanned, 'checking against periods:', periods.map(p => `${p.title} (${p.startTime}-${p.endTime})`));
  if (!log.time_scanned) {
    console.log('No time_scanned for log:', log.id);
    return null;
  }
  const logTime = extractLogTimeValue(log.time_scanned);
  if (!logTime) {
    console.log('Invalid timestamp format for log:', log.id, log.time_scanned);
    return null;
  }
  let earlyBuffer = 10;
  const [logHour, logMinute] = logTime.split(":").map(Number);
  const logTotalMinutes = logHour * 60 + logMinute;
  for (const p of periods) {
    const [startHour, startMinute] = p.startTime.split(":").map(Number);
    const [endHour, endMinute] = p.endTime.split(":").map(Number);
    const startTotalMinutes = startHour * 60 + startMinute;
    const endTotalMinutes = endHour * 60 + endMinute;
    const earlyTotalMinutes = startTotalMinutes - earlyBuffer;
    if (logTotalMinutes >= earlyTotalMinutes && logTotalMinutes <= endTotalMinutes) {
      //console.log(`Assigning period "${p.title}" to log ${log.id} (scanned at ${logTime})`);
      return p.title;
    }
  }
  console.log(`Unable to match any period for log ${log.id} scanned at ${logTime}; considered periods:`, periods);
  return null;
}

async function assignStatusesToLogs() {
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
      WHERE status IS NULL
         OR BTRIM(status) = ''
         OR LOWER(BTRIM(status)) IN ('na', 'unknown', 'auto', 'auto assign', 'null')
    `);
    //console.log(`Found ${result.rows.length} logs without assigned statuses`);
    const logsByDate = {};
    result.rows.forEach(log => {
      const date = log.date_scanned;
      if (!logsByDate[date]) {
        logsByDate[date] = [];
      }
      logsByDate[date].push(log);
    });
    for (const date of Object.keys(logsByDate)) {
      const periods = await getPeriodsForDate(date);
      for (const log of logsByDate[date]) {
        const status = assignStatusForLog(log, periods);
        if (status) {
          await pool.query("UPDATE logs SET status = $1 WHERE id = $2", [status, log.id]);
          console.log(`Assigned ${status} to log ${log.id}`);
        } else {
          console.log(`No status assigned for log ${log.id}, leaving blank`);
        }
      }
    }
  } catch (err) {
    console.error("Error assigning statuses:", err);
  }
}

async function assignPeriodsToLogs() {
  try {
    const result = await pool.query("SELECT * FROM logs WHERE period IS NULL OR period = '' OR period = 'na'");
    //console.log(`Found ${result.rows.length} logs without assigned periods`);
    const logsByDate = {};
    result.rows.forEach(log => {
      const date = log.date_scanned;
      if (!logsByDate[date]) {
        logsByDate[date] = [];
      }
      logsByDate[date].push(log);
    });
    for (const date of Object.keys(logsByDate)) {
      const periods = await getPeriodsForDate(date);
      for (const log of logsByDate[date]) {
        const period = assignPeriodForLog(log, periods);
        if (period) {
          await pool.query("UPDATE logs SET period = $1 WHERE id = $2", [period, log.id]);
          console.log(`Assigned ${period} to log ${log.id}`);
        } else {
          console.log(`No period assigned for log ${log.id}, leaving blank`);
        }
      }
    }
  } catch (err) {
    console.error("Error assigning periods:", err);
  }
}

function convertTo24HourFormat(time12h) {
  if (!time12h) return null;
  const time = time12h.trim();
  const regex = /^(\d{1,2}):(\d{2}):(\d{2})\s(AM|PM)$/i;
  const match = time.match(regex);
  if (!match) {
    return time;
  }
  let hours = parseInt(match[1]);
  const minutes = match[2];
  const seconds = match[3];
  const period = match[4].toUpperCase();
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
}



/*-------------------------------------- Encryption Functions --------------------------------------*/
function getDailyKey(dateString = null) {
  const date = dateString || new Date().toISOString().split('T')[0];
  return crypto
    .createHmac('sha256', MASTER_KEY)
    .update(date)
    .digest()
    .subarray(0, 32);
}

function encrypt(text) {
  const key = getDailyKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    date: new Date().toISOString().split('T')[0]
  };
}

function decrypt(encryptedData, ivHex, authTagHex, date) {
  const key = getDailyKey(date);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}


/*---------------------------------------- App Authentication ----------------------------------------------*/
app.post('/api/students', verifyToken, requireRole('administrator'), async (req, res) => {
  let { student_id, first_name, last_name, password, uuid } = req.body;
  if (!student_id || !password || !first_name || !last_name) {
    return res.status(400).json({error: 'All fields required'});
  }
  if (!uuid){
    uuid = uuid || null;
  }
  try {
    const hashedPassword = await bcryptjs.hash(password, 10);
    const result = await pool.query(`
      INSERT INTO students (student_id, first_name, last_name, password_hash, uuid)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, student_id, first_name, last_name
      `, [student_id, first_name, last_name, hashedPassword, uuid]);
    res.status(201).json(result.rows[0]);
  }
  catch (err){
    console.error(err);
    res.status(500).json({ error: 'Failed to create student'});
  }
});

app.get('/api/students', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, student_id, first_name, last_name, created_at FROM students ORDER BY student_id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

app.get('/api/students/search', verifyToken, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.json([]);
  }
  try {
    const result = await pool.query(`
      SELECT id, student_id, first_name, last_name, created_at
      FROM students
      WHERE CAST(student_id AS TEXT) ILIKE $1
         OR first_name ILIKE $1
         OR last_name ILIKE $1
      ORDER BY last_name ASC, first_name ASC, student_id ASC
      LIMIT 25
    `, [`%${query}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

app.get('/api/students/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, student_id, first_name, last_name, created_at FROM students WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

app.put('/api/students/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  const { student_id, first_name, last_name, password } = req.body;
  try {
    let query = 'UPDATE students SET ';
    let params = [];
    let paramCount = 1;

    if (student_id !== undefined) {
      query += `student_id = $${paramCount}, `;
      params.push(student_id);
      paramCount++;
    }
    if (first_name !== undefined) {
      query += `first_name = $${paramCount}, `;
      params.push(first_name);
      paramCount++;
    }
    if (last_name !== undefined) {
      query += `last_name = $${paramCount}, `;
      params.push(last_name);
      paramCount++;
    }
    if (password !== undefined) {
      const hashedPassword = await bcryptjs.hash(password, 10);
      query += `password_hash = $${paramCount}, `;
      params.push(hashedPassword);
      paramCount++;
    }
    query = query.slice(0, -2);
    query += ` WHERE id = $${paramCount} RETURNING id, student_id, first_name, last_name`;
    params.push(req.params.id);

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

app.delete('/api/students/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

app.post('/api/app/auth/login', async (req, res) => {
  const { student_id, password, uuid } = req.body;
  if (!student_id || !password) {
    return res.status(400).json({ error: 'Student ID and Password are required' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [student_id]
    );
    const student = result.rows[0];
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid Student ID or password' });
    }
    if (student.uuid && student.uuid !== uuid) {
    return res.status(403).json({ error: 'This device is not authorized' });
  }
    if (!student.uuid) {
      await pool.query(
        `UPDATE students
        SET uuid = $1
        WHERE id = $2 AND uuid IS NULL`,
        [uuid, student.id]
      );
    }
    const passwordMatch = await bcryptjs.compare(
      password,
      student.password_hash
    );
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid Student ID or password' });
    }
    if (student.uuid && student.uuid !== uuid) {
      return res.status(403).json({ error: 'This device is not authorized' });
    }
    if (!student.uuid) {
      await pool.query(
        'UPDATE students SET uuid = $1 WHERE id = $2',
        [uuid, student.id]
      );
    } 
    const token = jwt.sign(
      { 
        id: student_id, 
        uuid: uuid
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    req.session.user = {
      id: student_id, 
      uuid: uuid,
      token: token
    };
    res.json({ 
      message: 'Login successful',
      token: token,
      user: {
        id: student_id, 
        uuid: uuid
      }
    });
  } catch (err) {
    console.error('Login Error: ', err);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/app/encrypt_student_id', verifyToken, (req, res) => {
  const { student_id } = req.body;
  if (!student_id) {
    return res.status(400).json({ error: 'Student ID is required' });
  }
  try {
    const encrypted = encrypt(student_id);
    res.json(encrypted);
  } catch (err) {
    console.error('Encryption error:', err);
    res.status(500).json({ error: 'Failed to encrypt student ID' });
  }
});

app.post('/api/app/students/:id/reset_uuid', verifyToken, requireRole('administrator'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('UPDATE students SET uuid = NULL WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'UUID reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset UUID' });
  }
});


/*---------------------------------------- Scanner Authentication ----------------------------------------------*/
app.post('/api/scanners', verifyToken, requireRole('administrator'), async (req, res) => {
  const { SCANNER_ID, SCANNER_LOCATION, SCANNER_PASSWORD } = req.body;
  if (!SCANNER_ID || !SCANNER_LOCATION || !SCANNER_PASSWORD) {
    return res.status(400).json({error: 'All fields required'});
  }
  try {
    const hashedPassword = await bcryptjs.hash(SCANNER_PASSWORD, 10);
    const result = await pool.query(`
      INSERT INTO scanners (scanner_id, scanner_location, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, scanner_id, scanner_location
      `, [SCANNER_ID, SCANNER_LOCATION, hashedPassword]);
    res.status(201).json(result.rows[0]);
  }
  catch (err){
    console.error(err);
    res.status(500).json({ error: 'Failed to create scanner'});
  }
});

app.get('/api/scanners', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, scanner_id, scanner_location, scanner_status, last_sync, battery_level FROM scanners ORDER BY scanner_id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch scanners' });
  }
});

app.get('/api/scanners/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, scanner_id, scanner_location, scanner_status, last_sync, battery_level FROM scanners WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scanner not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch scanner' });
  }
});

app.put('/api/scanners/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  const { scanner_id, scanner_location, scanner_password } = req.body;
  try {
    let query = 'UPDATE scanners SET ';
    let params = [];
    let paramCount = 1;
    if (scanner_id !== undefined) {
      query += `scanner_id = $${paramCount}, `;
      params.push(scanner_id);
      paramCount++;
    }
    if (scanner_location !== undefined) {
      query += `scanner_location = $${paramCount}, `;
      params.push(scanner_location);
      paramCount++;
    }
    if (scanner_password !== undefined) {
      const hashedPassword = await bcryptjs.hash(scanner_password, 10);
      query += `password_hash = $${paramCount}, `;
      params.push(hashedPassword);
      paramCount++;
    }
    query = query.slice(0, -2);
    query += ` WHERE id = $${paramCount} RETURNING id, scanner_id, scanner_location`;
    params.push(req.params.id);
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scanner not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update scanner' });
  }
});

app.delete('/api/scanners/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM scanners WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scanner not found' });
    }
    res.json({ message: 'Scanner deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete scanner' });
  }
});

app.post('/api/scanner/auth/login', async (req, res) => {
  const {SCANNER_ID, SCANNER_LOCATION, SCANNER_PASSWORD} = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM scanners WHERE scanner_id = $1',
      [SCANNER_ID]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid Scanner ID or password' });
    }
    const scanner = result.rows[0];
    const passwordMatch = await bcryptjs.compare(
      SCANNER_PASSWORD,
      scanner.password_hash
    );
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid Scanner ID or password' });
    }
    const token = jwt.sign(
      { 
        id: scanner.id,
        scanner_id: scanner.scanner_id
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    req.session.user = {
      id: scanner.id,
      scanner_id: scanner.scanner_id,
      token: token
    };
    res.json({ 
      message: 'Login successful',
      token: token,
      user: {
        id: scanner.id,
        scanner_id: scanner.scanner_id
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/api/scanner/key_me', verifyToken, async (req, res) => {
  try {
    const result = getDailyKey();
    res.json({
      key: result
    });
  } catch (err) {
    console.error('Error fetching daily key:', err);
    res.status(500).json({ error: 'Failed to fetch daily key' });
  }
});

const scannerTerminalSessions = {};

function getScannerSession(scannerId) {
  if (!scannerTerminalSessions[scannerId]) {
    scannerTerminalSessions[scannerId] = {
      mode: 'scanner',
      commandQueue: [],
      nextCommandId: 1,
      lastOutput: '',
      lastOutputTime: null,
      outputVersion: 0,
      outputHistory: [],
      scannerLastSeenAt: null
    };
  }
  return scannerTerminalSessions[scannerId];
}

function normalizeScannerMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'enroll' || value === 'enrollment') return 'enroll';
  return 'scanner';
}

function modeFromTerminalCommand(command, currentMode) {
  const value = String(command || '').trim().toLowerCase();
  if (value === 'enroll' || value === 'mode enroll' || value === 'enter enroll') {
    return 'enroll';
  }
  if (value === 'scanner' || value === 'scan' || value === 'mode scanner' || value === 'exit' || value === 'cancel') {
    return 'scanner';
  }
  return currentMode;
}

app.post('/api/scanners/:id/terminal', verifyToken, requireRole('administrator'), async (req, res) => {
  const scannerId = req.params.id;
  const { command } = req.body;
  if (typeof command !== 'string') {
    return res.status(400).json({ error: 'Command must be a string' });
  }
  console.log(`[BACKEND] Received command for scanner ${req.params.id}:`, req.body.command);
  const session = getScannerSession(scannerId);
  const cmd = command.trim();
  
  // Mode change commands (optional – can also be handled by scanner)
  if (cmd === 'enroll' || cmd === 'scanner') {
    session.mode = cmd === 'enroll' ? 'enroll' : 'scanner';
  }
  
  const commandId = session.nextCommandId++;
  const ws = scannerSockets.get(scannerId);

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      command: cmd,
      commandId
    }));
  } else {
    // fallback to queue (offline scanner)
    session.commandQueue.push({ command: cmd, commandId });
  }
  const MAX_QUEUE_SIZE = 5;
  if (session.commandQueue.length > MAX_QUEUE_SIZE) {
    session.commandQueue.shift(); // remove oldest
  }
  
  res.json({ 
    message: 'Command queued for scanner',
    pending: true,
    mode: session.mode,
    commandId: commandId
  });
});

app.get('/api/scanners/:id/terminal', verifyToken, (req, res) => {
  const scannerId = req.params.id;
  const session = getScannerSession(scannerId);
  session.scannerLastSeenAt = new Date();
  
  if (session.commandQueue.length > 0) {
    const next = session.commandQueue.shift();  // remove from front
    res.json({ 
      command: next.command,
      mode: session.mode,
      commandId: next.commandId
    });
  } else {
    res.json({ 
      command: null,
      mode: session.mode,
      commandId: session.nextCommandId  // or just 0
    });
  }
});

app.post('/api/scanners/:id/heartbeat', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE scanners SET last_sync = NOW(), scanner_status = 'online' WHERE id = $1`,
      [id]
    );
    res.json({ message: 'Heartbeat received' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

app.post('/api/scanners/:id/terminal/output', verifyToken, async (req, res) => {
  const scannerId = req.params.id;
  const { output, mode, commandId } = req.body;
  console.log(`[SCANNER ${req.params.id}] ${output}`);
  const session = getScannerSession(scannerId);
  const now = new Date();
  session.scannerLastSeenAt = now;
  session.mode = normalizeScannerMode(mode || session.mode);

  if (typeof output === 'string' && output.trim() !== '') {
    session.lastOutput = output;
    session.lastOutputTime = now;
    session.outputVersion += 1;
    session.outputHistory.push({
      version: session.outputVersion,
      output,
      timestamp: now,
      commandId: commandId ?? null
    });
    if (session.outputHistory.length > 50) {
      session.outputHistory = session.outputHistory.slice(-50);
    }
  }

  res.json({ message: 'Output received', mode: session.mode });
});

app.get('/api/scanners/:id/terminal/output', verifyToken, requireRole('administrator'), (req, res) => {
  const scannerId = req.params.id;
  const session = getScannerSession(scannerId);
  const afterVersion = Number(req.query.afterVersion || 0);
  const entries = session.outputHistory.filter(entry => entry.version > afterVersion);
  res.json({ 
    output: session.lastOutput || '', 
    timestamp: session.lastOutputTime || null,
    mode: session.mode,
    outputVersion: session.outputVersion,
    scannerLastSeenAt: session.scannerLastSeenAt || null,
    entries
  });
});


/*---------------------------------------API Endpoints---------------------------------------*/

/*-------Authentication Endpoints-------*/
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const passwordMatch = await bcryptjs.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      token: token
    };
    res.json({ 
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, role, created_at, courses FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});



/*-------User Management Endpoints-------*/
app.post('/api/users', verifyToken, requireRole('administrator'), async (req, res) => {
  const { email, first_name, last_name, password, role, courses } = req.body;
  if (!email || !password || !first_name || !last_name || !role) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (!['teacher', 'administrator'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const hashedPassword = await bcryptjs.hash(password, 10);
    const courseArray = role === 'teacher' && courses ? courses : [];
    const result = await pool.query(`
      INSERT INTO users (email, first_name, last_name, password_hash, role, courses)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, first_name, last_name, role, courses
    `, [email.toLowerCase(), first_name, last_name, hashedPassword, role, courseArray]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/users', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, first_name, last_name, role, created_at, courses FROM users ORDER BY email ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/users/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, first_name, last_name, role, created_at, courses FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.put('/api/users/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  const { email, first_name, last_name, password, role, courses } = req.body;
  try {
    let query = 'UPDATE users SET ';
    let params = [];
    let paramCount = 1;
    if (email !== undefined) {
      query += `email = $${paramCount}, `;
      params.push(email.toLowerCase());
      paramCount++;
    }
    if (first_name !== undefined) {
      query += `first_name = $${paramCount}, `;
      params.push(first_name);
      paramCount++;
    }
    if (last_name !== undefined) {
      query += `last_name = $${paramCount}, `;
      params.push(last_name);
      paramCount++;
    }
    if (password !== undefined) {
      const hashedPassword = await bcryptjs.hash(password, 10);
      query += `password_hash = $${paramCount}, `;
      params.push(hashedPassword);
      paramCount++;
    }
    if (role !== undefined) {
      if (!['teacher', 'administrator'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      query += `role = $${paramCount}, `;
      params.push(role);
      paramCount++;
    }
    if (courses !== undefined) {
      const courseArray = role === 'teacher' && courses ? courses : [];
      query += `courses = $${paramCount}, `;
      params.push(courseArray);
      paramCount++;
    }
    query = query.slice(0, -2);
    query += ` WHERE id = $${paramCount} RETURNING id, email, first_name, last_name, role, courses`;
    params.push(req.params.id);
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});



/*---------------------------- Current Class Map Endpoints ----------------------------*/
app.post('/api/map-layout', verifyToken, async (req, res) => {
  try {
    const mapData = req.body;
    await pool.query(`
      INSERT INTO map_layouts (id, data)
      VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = CURRENT_TIMESTAMP
    `, [JSON.stringify(mapData)]);
    res.json({ message: 'Map saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save map' });
  }
});
 
app.get('/api/map-layout', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT data FROM map_layouts WHERE id = 1
    `);
    if (result.rows.length === 0) {
      return res.json({ rooms: [], scanners: [] });
    }
    res.json(result.rows[0].data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load map' });
  }
});


/*-------Courses Endpoints-------*/
app.post('/api/courses', verifyToken, requireRole('administrator'), async (req, res) => {
  const { room, period } = req.body;
  if (!room || !period) {
    return res.status(400).json({ error: 'Room and period are required' });
  }
  try {
    const result = await pool.query(`
      INSERT INTO courses (room, period)
      VALUES ($1, $2)
      RETURNING id, room, period
    `, [room, period]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This course already exists' });
    }
    res.status(500).json({ error: 'Failed to create course' });
  }
});

app.get('/api/courses', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, room, period FROM courses ORDER BY period ASC, room ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

app.delete('/api/courses/:id', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING id', [req.params.id]);
    await pool.query('UPDATE users SET courses = array_remove(courses, $1) WHERE $1 = ANY(courses)', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json({ message: 'Course deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

/*-------Calendar Endpoints-------*/
app.get('/api/calendar/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const periods = await getPeriodsForDate(today);
    res.json({
      events: periods,
      lastUpdated: calendarCache.lastUpdated,
      date: today
    });
  } catch (err) {
    console.error(err);
    res.json({
      events: getFallbackPeriods(),
      lastUpdated: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0]
    });
  }
});



/*-------Log Endpoints-------*/
app.get('/api/logs', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
      ORDER BY date_scanned DESC, time_scanned DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.post('/api/logs', verifyToken, async (req, res) => {
  let {
    period,
    scanner_location,
    scanner_id,
    student_id,
    first_name,
    last_name,
    time_scanned,
    date_scanned,
    status
  } = req.body;
  try {
    period = normalizeOptionalValue(period);
    status = normalizeOptionalValue(status);
    first_name = normalizeOptionalValue(first_name);
    last_name = normalizeOptionalValue(last_name);
    scanner_location = normalizeOptionalValue(scanner_location);
    scanner_id = normalizeOptionalValue(scanner_id);
    student_id = normalizeOptionalValue(student_id);
    date_scanned = normalizeOptionalValue(date_scanned);
    time_scanned = normalizeOptionalValue(time_scanned);

    if (student_id && (!first_name || !last_name)) {
      const studentLookup = await pool.query(
        'SELECT first_name, last_name FROM students WHERE CAST(student_id AS TEXT) = $1 LIMIT 1',
        [student_id]
      );
      if (studentLookup.rows.length > 0) {
        first_name = first_name || normalizeOptionalValue(studentLookup.rows[0].first_name);
        last_name = last_name || normalizeOptionalValue(studentLookup.rows[0].last_name);
      } else {
        const priorLogLookup = await pool.query(`
          SELECT first_name, last_name
          FROM logs
          WHERE student_id = $1
            AND first_name IS NOT NULL
            AND BTRIM(first_name) <> ''
            AND last_name IS NOT NULL
            AND BTRIM(last_name) <> ''
          ORDER BY id DESC
          LIMIT 1
        `, [student_id]);
        if (priorLogLookup.rows.length > 0) {
          first_name = first_name || normalizeOptionalValue(priorLogLookup.rows[0].first_name);
          last_name = last_name || normalizeOptionalValue(priorLogLookup.rows[0].last_name);
        }
      }
    }

    if (date_scanned && time_scanned) {
      const time24h = convertTo24HourFormat(time_scanned);
      time_scanned = time24h;
      const fullTimestamp = `${date_scanned} ${time24h}`;
      const periods = await getPeriodsForDate(date_scanned);
      const computed = assignPeriodForLog({ id: 'new', time_scanned: fullTimestamp }, periods);
      if (computed) {
        period = period || computed;
        //console.log(`Computed period for new log: ${period}`);
      } else {
        console.log('Could not compute period for new log, will fill later');
      }
    }
    await pool.query(`
      INSERT INTO logs (
        period,
        scanner_location,
        scanner_id,
        student_id,
        first_name,
        last_name,
        time_scanned,
        date_scanned,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [period, scanner_location, scanner_id, student_id, first_name, last_name, time_scanned, date_scanned, status]);
    await assignPeriodsToLogs();
    await assignStatusesToLogs();
    res.status(201).json({ message: 'Log entry created successfully' });
  } catch (err) {
    console.error('Error creating log entry:', err);
    res.status(500).json({ error: 'Failed to create log entry' });
  }
});

app.delete('/api/logs/:id', verifyToken, async (req, res) => {
  const logId = req.params.id;
  try {
    await pool.query('DELETE FROM logs WHERE id = $1', [logId]);
    res.json({ message: 'Log entry deleted successfully' });
  } catch (err) {
    console.error('Error deleting log entry:', err);
    res.status(500).json({ error: 'Failed to delete log entry' });
  }
});

app.post('/api/logs/assign-periods', verifyToken, async (req, res) => {
  try {
    await assignPeriodsToLogs();
    res.json({ message: 'Periods assigned to all eligible logs' });
  } catch (err) {
    console.error('Error assigning periods:', err);
    res.status(500).json({ error: 'Failed to assign periods' });
  }
});

app.post('/api/logs/assign-statuses', verifyToken, async (req, res) => {
  try {
    await assignStatusesToLogs();
    res.json({ message: 'Statuses assigned to all eligible logs' });
  } catch (err) {
    console.error('Error assigning statuses:', err);
    res.status(500).json({ error: 'Failed to assign statuses' });
  }
});

app.get('/api/logs/analytics', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT first_name, last_name, scanner_location, student_id, period, COUNT(*) AS total
      FROM logs
      GROUP BY first_name, last_name, scanner_location, student_id, period
      ORDER BY first_name ASC, last_name ASC, period ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.get('/api/logs/:room', verifyToken, async (req, res) => {
  const { room } = req.params;
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
      WHERE scanner_location = $1
    `, [room]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs for room and period:', err);
    res.status(500).json({ error: 'Failed to fetch logs for room and period' });
  }
});

app.get('/api/logs/:room/:period', verifyToken, async (req, res) => {
  const { room, period } = req.params;
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
      WHERE scanner_location = $1 AND period = $2
    `, [room, period]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs for room and period:', err);
    res.status(500).json({ error: 'Failed to fetch logs for room and period' });
  }
});

app.get('/api/logs/:room/:period/:date', verifyToken, async (req, res) => {
  const { room, period, date } = req.params;
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
      WHERE scanner_location = $1 AND period = $2 AND date_scanned = $3
    `, [room, period, date]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs for room and period:', err);
    res.status(500).json({ error: 'Failed to fetch logs for room and period' });
  }
});



/*---------------------------------------- Settings Endpoints ----------------------------------------------*/
app.get('/api/settings/grace-period', verifyToken, requireRole('administrator'), (req, res) => {
  res.json({ value: ATTENDANCE_GRACE_PERIOD_MINUTES });
});

app.put('/api/settings/grace-period', verifyToken, requireRole('administrator'), (req, res) => {
  const { value } = req.body;
  if (isNaN(value) || value < 0) {
    return res.status(400).json({ error: 'Invalid value' });
  }
  settings.gracePeriodMinutes = Number(value);
  saveSettings();
  ATTENDANCE_GRACE_PERIOD_MINUTES = Number(value);
  res.json({ success: true });
});

/*----------------------------------------Routes----------------------------------------*/
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'room.html'));
});

app.get('/profile', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'profile.html'));
});

app.get('/analytics', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'analytics.html'));
});

app.get('/master_logs', redirectIfNotAuthenticated, requireRole('administrator'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'master_logs.html'));
});

app.get('/calendar', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'calendar.html'));
});

app.get('/map', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'current_class_map.html'));
});

app.get('/lookup', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'student_lookup.html'));
});

app.get('/scanners', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'connected_scanners.html'));
});

app.get('/app_settings', redirectIfNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'app_settings.html'));
});

app.get('/admin', redirectIfNotAuthenticated, requireRole('administrator'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});



/*----------------------------------------Start Server----------------------------------------*/
async function startServer() {
  await initializeDatabase();
  setInterval(async () => {
    try {
      await pool.query(`
        UPDATE scanners 
        SET scanner_status = 'offline' 
        WHERE (last_sync IS NOT NULL)
          AND (last_sync::timestamp) < NOW() - INTERVAL '2 minutes'
          AND scanner_status = 'online'
      `);
    } catch (err) {
      console.error('Offline checker error:', err);
    }
  }, 30 * 1000);
  loadSettings();
  server.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
export {
  getFallbackPeriods,
  extractPeriods,
  assignPeriodForLog,
  getPeriodsForDate,
  calendarCache
};
