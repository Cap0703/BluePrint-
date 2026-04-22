import 'dotenv/config';

// ===== ADD THIS FOR DEBUGGING =====
const DEBUG_WS = true;  // Set to false to disable verbose logging
process.env.TZ = "America/Los_Angeles";
function wsLog(msg, data = null) {
  if (DEBUG_WS) {
    const timestamp = new Date().toISOString();
    if (data) {
      console.log(`[${timestamp}] [WS] ${msg}`, data);
    } else {
      console.log(`[${timestamp}] [WS] ${msg}`);
    }
  }
}

import os from 'os';
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
import https from 'https';

const useHttps = process.env.USE_HTTPS === 'true';
let server;

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

if (useHttps) {
  try {
    const key = fs.readFileSync(path.join(os.homedir(), 'certs/key.pem'));
    const cert = fs.readFileSync(path.join(os.homedir(), 'certs/cert.pem'));
    server = https.createServer({ key, cert }, app);
    console.log('✅ HTTPS enabled');
  } catch (err) {
    console.error('❌ HTTPS setup failed:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server });

const CALENDAR_CACHE_FILE = path.join(__dirname, 'cache', 'calendar_cache.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const MASTER_KEY = Buffer.from(process.env.MASTER_KEY, 'hex');
let ATTENDANCE_GRACE_PERIOD_MINUTES = Number(process.env.GRACE_PERIOD_MINUTES || 10);

let settings = { gracePeriodMinutes: ATTENDANCE_GRACE_PERIOD_MINUTES };

const frontendSockets = new Set();

wss.on('connection', (ws, req) => {
  const connectionId = Math.random().toString(36).substr(2, 9);
  const remoteAddress = req.socket.remoteAddress;
  const pingInterval = setInterval(() => {
  if (ws.readyState === ws.OPEN) ws.ping();
  }, 30000);
  ws.on('close', () => clearInterval(pingInterval));
  
  wsLog(`New connection [${connectionId}] from ${remoteAddress}`, { url: req.url });
  
  let scannerId = null;
  let isFrontend = false;
  let messageCount = 0;
  
  // Handle errors on the socket itself
  ws.on('error', (err) => {
    wsLog(`Socket error [${connectionId}]: ${err.message}`);
  });
  
  // Handle incoming messages
  ws.on('message', (message) => {
    messageCount++;
    wsLog(`Message #${messageCount} [${connectionId}] received, length: ${message.length} bytes`);
    
    try {
      wsLog(`Parsing JSON...`);
      const data = JSON.parse(message.toString());
      wsLog(`Message parsed successfully`, { type: data.type, scannerId: data.scannerId });
      
      if (data.type === 'auth') {
        scannerId = data.scannerId;
        wsLog(`Auth message from scanner [${scannerId}]`, { connectionId });
        scannerSockets.set(scannerId, ws);
        wsLog(`Scanner socket registered`, { scannerId, totalScanners: scannerSockets.size });
      }
      
      if (data.type === 'frontend') {
        isFrontend = true;
        ws.scannerId = data.scannerId;
        wsLog(`Frontend connection for scanner [${data.scannerId}]`, { connectionId });
        frontendSockets.add(ws);
        wsLog(`Frontend socket registered`, { totalFrontends: frontendSockets.size });
      }
      
      if (data.type === 'output') {
        wsLog(`Output message from scanner [${data.scannerId}]`);
        console.log(`[SCANNER ${data.scannerId}] ${data.output}`);
        
        let relayCount = 0;
        frontendSockets.forEach(client => {
          if (client.readyState === 1 && String(client.scannerId) === String(data.scannerId)) {
            try {
              client.send(JSON.stringify({
                type: "output",
                scannerId: data.scannerId,
                output: data.output
              }));
              relayCount++;
            } catch (sendErr) {
              wsLog(`Error relaying to frontend: ${sendErr.message}`);
            }
          }
        });
        wsLog(`Output relayed to ${relayCount} frontend(s)`);
      }

      if (data.type === 'command') {
        const targetScannerId = data.scannerId;
        wsLog(`Command from frontend for scanner [${targetScannerId}]`, { command: data.command });
        
        const scannerSocket = scannerSockets.get(targetScannerId);
        if (scannerSocket && scannerSocket.readyState === 1) {
          try {
            scannerSocket.send(JSON.stringify({
              command: data.command,
              commandId: data.commandId || Math.random()
            }));
            wsLog(`Command sent to scanner [${targetScannerId}]`);
          } catch (sendErr) {
            wsLog(`Error sending command to scanner: ${sendErr.message}`);
          }
        } else {
          wsLog(`Scanner [${targetScannerId}] not connected or not ready`);
          // Notify frontend that scanner is offline
          frontendSockets.forEach(client => {
            if (client.readyState === 1 && String(client.scannerId) === String(targetScannerId)) {
              try {
                client.send(JSON.stringify({
                  type: "error",
                  message: `Scanner ${targetScannerId} is not connected`
                }));
              } catch (err) {
                wsLog(`Error notifying frontend: ${err.message}`);
              }
            }
          });
        }
      }
      
    } catch (parseErr) {
      wsLog(`ERROR: Failed to parse JSON [${connectionId}]`, { 
        error: parseErr.message,
        rawMessage: message.toString().substring(0, 100) 
      });
      try {
        ws.close(1002, 'Invalid JSON');
      } catch (closeErr) {
        wsLog(`Error closing socket: ${closeErr.message}`);
      }
    }
  });
  
  // Handle connection close
  ws.on('close', (code, reason) => {
    wsLog(`Connection closed [${connectionId}]`, { 
      code, 
      reason: reason ? reason.toString() : 'none',
      scannerId,
      isFrontend,
      messagesReceived: messageCount
    });
    
    if (scannerId) {
      scannerSockets.delete(scannerId);
      wsLog(`Scanner ${scannerId} unregistered`, { remaining: scannerSockets.size });
    }
    if (isFrontend) {
      frontendSockets.delete(ws);
      wsLog(`Frontend unregistered`, { remaining: frontendSockets.size });
    }
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

function getLosAngelesDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
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

function normalizeLogDateValue(value) {
  const normalized = normalizeOptionalValue(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalized;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeLogTimeValue(value) {
  const normalized = normalizeOptionalValue(value);
  if (!normalized) return null;
  const extracted = extractLogTimeValue(normalized);
  const converted = convertTo24HourFormat(extracted);
  const match = String(converted).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return converted;
  const hours = String(match[1]).padStart(2, '0');
  const minutes = match[2];
  const seconds = match[3] || '00';
  return `${hours}:${minutes}:${seconds}`;
}

function getLogTimestampValue(log) {
  const dateValue = normalizeLogDateValue(log?.date_scanned);
  const timeValue = normalizeLogTimeValue(log?.time_scanned);
  if (!dateValue || !timeValue) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(`${dateValue}T${timeValue}`);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function compareLogsChronologically(left, right) {
  const timestampDiff = getLogTimestampValue(right) - getLogTimestampValue(left);
  if (timestampDiff !== 0) return timestampDiff;
  return Number(right?.id || 0) - Number(left?.id || 0);
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

function convertToCsv(logs) {
  const header = [
    'ID',
    'Date Scanned',
    'Time Scanned',
    'Student ID',
    'First Name',
    'Last Name',
    'Period',
    'Scanner Location',
    'Scanner ID',
    'Status'
  ];
  const rows = logs.map(log => [
    log.id,
    log.date_scanned,
    normalizeLogTimeValue(log.time_scanned),
    log.student_id,
    log.first_name,
    log.last_name,
    log.period,
    log.scanner_location,
    log.scanner_id,
    log.status
  ]);
  const csvContent = [header, ...rows]
    .map(row => row.map(escapeCsvValue).join(','))
    .join("\n");
  return csvContent;
}

function escapeCsvValue(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  if (!/[",\n\r]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function normalizeRequiredString(value, fieldLabel) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${fieldLabel} is required`);
  }
  return normalized;
}

function parseCourseAssignments(courses) {
  if (courses === undefined || courses === null || courses === '') return [];
  if (Array.isArray(courses)) {
    return courses
      .map(course => Number(course))
      .filter(course => Number.isInteger(course) && course > 0);
  }
  return String(courses)
    .split(/[|;,]/)
    .map(part => Number(part.trim()))
    .filter(course => Number.isInteger(course) && course > 0);
}

async function createStudentAccount(payload) {
  let { student_id, first_name, last_name, password, uuid } = payload;
  student_id = normalizeRequiredString(student_id, 'Student ID');
  first_name = normalizeRequiredString(first_name, 'First name');
  last_name = normalizeRequiredString(last_name, 'Last name');
  password = normalizeRequiredString(password, 'Password');
  uuid = normalizeOptionalValue(uuid);

  const hashedPassword = await bcryptjs.hash(password, 10);
  const result = await pool.query(`
    INSERT INTO students (student_id, first_name, last_name, password_hash, uuid)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, student_id, first_name, last_name
  `, [student_id, first_name, last_name, hashedPassword, uuid]);

  return result.rows[0];
}

async function createScannerAccount(payload) {
  let { scanner_id, scanner_location, scanner_password, password } = payload;
  scanner_id = normalizeRequiredString(scanner_id, 'Scanner ID');
  scanner_location = normalizeRequiredString(scanner_location, 'Scanner location');
  const rawPassword = normalizeRequiredString(scanner_password ?? password, 'Scanner password');

  const hashedPassword = await bcryptjs.hash(rawPassword, 10);
  const result = await pool.query(`
    INSERT INTO scanners (scanner_id, scanner_location, password_hash)
    VALUES ($1, $2, $3)
    RETURNING id, scanner_id, scanner_location
  `, [scanner_id, scanner_location, hashedPassword]);

  return result.rows[0];
}

async function createWebUserAccount(payload) {
  let { email, first_name, last_name, password, role, courses } = payload;
  email = normalizeRequiredString(email, 'Email').toLowerCase();
  first_name = normalizeRequiredString(first_name, 'First name');
  last_name = normalizeRequiredString(last_name, 'Last name');
  password = normalizeRequiredString(password, 'Password');
  role = normalizeRequiredString(role, 'Role').toLowerCase();
  if (!['teacher', 'administrator'].includes(role)) {
    throw new Error('Role must be teacher or administrator');
  }

  const courseArray = role === 'teacher' ? parseCourseAssignments(courses) : [];
  const hashedPassword = await bcryptjs.hash(password, 10);
  const result = await pool.query(`
    INSERT INTO users (email, first_name, last_name, password_hash, role, courses)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, email, first_name, last_name, role, courses
  `, [email, first_name, last_name, hashedPassword, role, courseArray]);

  return result.rows[0];
}

async function buildPreparedLogEntry(rawLog, options = {}) {
  const {
    requireStudentId = true,
    requireScannerFields = true
  } = options;
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
  } = rawLog;

  period = normalizeOptionalValue(period);
  status = normalizeOptionalValue(status);
  first_name = normalizeOptionalValue(first_name);
  last_name = normalizeOptionalValue(last_name);
  scanner_location = normalizeOptionalValue(scanner_location);
  scanner_id = normalizeOptionalValue(scanner_id);
  student_id = normalizeOptionalValue(student_id);
  date_scanned = normalizeLogDateValue(date_scanned);
  time_scanned = normalizeLogTimeValue(time_scanned);

  if (requireStudentId && !student_id) {
    throw new Error('Student ID is required');
  }

  if (requireScannerFields && (!scanner_location || !scanner_id)) {
    throw new Error('Scanner location and scanner ID are required');
  }

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
    const fullTimestamp = `${date_scanned} ${time_scanned}`;
    const periods = await getPeriodsForDate(date_scanned);
    const computed = assignPeriodForLog({ id: 'new', time_scanned: fullTimestamp }, periods);
    if (computed) {
      period = period || computed;
    } else {
      console.log('Could not compute period for new log, will fill later');
    }
  }

  return {
    period,
    scanner_location,
    scanner_id,
    student_id,
    first_name,
    last_name,
    time_scanned,
    date_scanned,
    status
  };
}

async function insertPreparedLogEntry(preparedLog) {
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
  `, [
    preparedLog.period,
    preparedLog.scanner_location,
    preparedLog.scanner_id,
    preparedLog.student_id,
    preparedLog.first_name,
    preparedLog.last_name,
    preparedLog.time_scanned,
    preparedLog.date_scanned,
    preparedLog.status
  ]);
}



/*-------------------------------------- Encryption Functions --------------------------------------*/
function getDailyKey(dateString = null) {
  const date = dateString || getLosAngelesDateString();
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
    date: getLosAngelesDateString()
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
  try {
    const createdStudent = await createStudentAccount(req.body);
    res.status(201).json(createdStudent);
  }
  catch (err){
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create student'});
  }
});

app.post('/api/students/bulk', verifyToken, requireRole('administrator'), async (req, res) => {
  const rows = Array.isArray(req.body?.students) ? req.body.students : [];
  if (!rows.length) {
    return res.status(400).json({ error: 'No student rows were provided' });
  }

  try {
    for (const row of rows) {
      await createStudentAccount(row);
    }
    res.status(201).json({ message: 'Students uploaded successfully', inserted: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to upload students' });
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
  try {
    const createdScanner = await createScannerAccount({
      scanner_id: req.body.SCANNER_ID,
      scanner_location: req.body.SCANNER_LOCATION,
      scanner_password: req.body.SCANNER_PASSWORD
    });
    res.status(201).json(createdScanner);
  }
  catch (err){
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create scanner'});
  }
});

app.post('/api/scanners/bulk', verifyToken, requireRole('administrator'), async (req, res) => {
  const rows = Array.isArray(req.body?.scanners) ? req.body.scanners : [];
  if (!rows.length) {
    return res.status(400).json({ error: 'No scanner rows were provided' });
  }

  try {
    for (const row of rows) {
      await createScannerAccount(row);
    }
    res.status(201).json({ message: 'Scanners uploaded successfully', inserted: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to upload scanners' });
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
  
  // Update server-side session mode optimistically so GET /terminal/output
  // returns the correct mode immediately, before the scanner echoes it back.
  if (cmd === 'set mode enroll') {
    session.mode = 'enroll';
  } else if (cmd === 'set mode scanner') {
    session.mode = 'scanner';
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
  try {
    const createdUser = await createWebUserAccount(req.body);
    res.status(201).json(createdUser);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: err.message || 'Failed to create user' });
  }
});

app.post('/api/users/bulk', verifyToken, requireRole('administrator'), async (req, res) => {
  const rows = Array.isArray(req.body?.users) ? req.body.users : [];
  if (!rows.length) {
    return res.status(400).json({ error: 'No user rows were provided' });
  }

  try {
    for (const row of rows) {
      await createWebUserAccount(row);
    }
    res.status(201).json({ message: 'Users uploaded successfully', inserted: rows.length });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'One or more emails already exist' });
    }
    res.status(500).json({ error: err.message || 'Failed to upload users' });
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
    const today = getLosAngelesDateString();
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
      date: getLosAngelesDateString()
    });
  }
});



/*-------Log Endpoints-------*/
app.get('/api/logs', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
    `);
    res.json(result.rows.sort(compareLogsChronologically));
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/api/logs/csv', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM logs
    `);
    const csv = convertToCsv(result.rows.sort(compareLogsChronologically));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=logs.csv');
    res.send(csv);
  } catch (err) {
    console.error('Error fetching logs for CSV:', err);
    res.status(500).json({ error: 'Failed to fetch logs for CSV' });
  }
});

app.post('/api/logs', verifyToken, async (req, res) => {
  try {
    const preparedLog = await buildPreparedLogEntry(req.body);
    await insertPreparedLogEntry(preparedLog);
    await assignPeriodsToLogs();
    await assignStatusesToLogs();
    res.status(201).json({ message: 'Log entry created successfully' });
  } catch (err) {
    console.error('Error creating log entry:', err);
    res.status(500).json({ error: 'Failed to create log entry' });
  }
});

app.post('/api/logs/bulk', verifyToken, async (req, res) => {
  const incomingLogs = Array.isArray(req.body?.logs) ? req.body.logs : [];
  if (!incomingLogs.length) {
    return res.status(400).json({ error: 'No log rows were provided' });
  }

  try {
    for (let index = 0; index < incomingLogs.length; index += 1) {
      const preparedLog = await buildPreparedLogEntry(incomingLogs[index], {
        requireStudentId: true,
        requireScannerFields: false
      });
      await insertPreparedLogEntry(preparedLog);
    }
    await assignPeriodsToLogs();
    await assignStatusesToLogs();
    res.status(201).json({ message: 'CSV logs uploaded successfully', inserted: incomingLogs.length });
  } catch (err) {
    console.error('Error uploading CSV logs:', err);
    res.status(500).json({ error: err.message || 'Failed to upload CSV logs' });
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

app.post('/api/admin/logs/clear', verifyToken, requireRole('administrator'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM logs');
    res.json({ message: 'All logs deleted successfully', deleted: result.rowCount || 0 });
  } catch (err) {
    console.error('Error clearing logs:', err);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

app.post('/api/admin/reindex', verifyToken, requireRole('administrator'), async (req, res) => {
  const databaseName = String(process.env.DB_NAME || '').trim();
  if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    return res.status(500).json({ error: 'Database name is not configured for reindexing' });
  }

  try {
    await pool.query(`REINDEX DATABASE ${databaseName}`);
    res.json({ message: `Database ${databaseName} reindexed successfully` });
  } catch (err) {
    console.error('Error reindexing database:', err);
    res.status(500).json({ error: 'Failed to reindex database' });
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
