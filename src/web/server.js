import 'dotenv/config';
import express from 'express';
import { pool, initializeDatabase } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());

const CALENDAR_CACHE_FILE = path.join(__dirname, 'cache', 'calendar_cache.json');

app.use(express.static(path.join(__dirname, "public")));

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

function getPeriodsToday() {
  if(!calendarCache.data || !calendarCache.data.events) {
    console.log('No calendar data available, using fallback periods');
    return getFallbackPeriods();
  }
  const periods = calendarCache.data.events.filter(event => {
    const title = event.title.toLowerCase();
    const isPeriod = !(title.includes('lunch') || title.includes('break') || title.includes('transition'));
    if (isPeriod) {
      console.log(`Found period: ${event.title} (${event.startTime} - ${event.endTime})`);
    }
    return isPeriod;
  });
  if (periods.length === 0) {
    console.log('No periods found in calendar data, using fallback');
    return getFallbackPeriods();
  }
  return periods;
}

loadCalendarCache();

/*----------------------------------------Log Functions----------------------------------------*/


















/*---------------------------------------API Endpoints---------------------------------------*/
app.get('/api/calendar/today', async (req, res) => {
  try {
    if (shouldUpdateCache()) {
      const data = await fetchCalendarFromAPI();
      saveCalendarCache(data);
    }
    const response = {
      events: calendarCache.data?.events || getFallbackPeriods(),
      lastUpdated: calendarCache.lastUpdated,
      date: calendarCache.data?.date || new Date().toISOString().split('T')[0]
    };
    res.json(response);
  } catch (err) {
    console.error(err);
    res.json({
      events: getFallbackPeriods(),
      lastUpdated: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0]
    });
  }
});

app.get('/api/logs', async (req, res) => {
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

app.post('/api/logs', async (req, res) => {
  const {
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
  try {    await pool.query(`
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
  `, [  period, scanner_location, scanner_id, student_id, first_name, last_name, time_scanned, date_scanned, status]);
  res.status(201).json({ message: 'Log entry created successfully' });
} catch (err) {
  console.error('Error creating log entry:', err);
  res.status(500).json({ error: 'Failed to create log entry' });
}
});

app.delete('/api/logs/:id', async (req, res) => {
  const logId = req.params.id;
  try {    await pool.query('DELETE FROM logs WHERE id = $1', [logId]);
    res.json({ message: 'Log entry deleted successfully' });
  } catch (err) {
    console.error('Error deleting log entry:', err);
    res.status(500).json({ error: 'Failed to delete log entry' });
  }
});

/*----------------------------------------Routes----------------------------------------*/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'profile.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'analytics.html'));
});

app.get('/master_logs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'master_logs.html'));
});

app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'calendar.html'));
});

app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'current_class_map.html'));
});

app.get('/lookup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'student_lookup.html'));
});

app.get('/scanners', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'connected_scanners.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'settings.html'));
});

/*----------------------------------------Start Server----------------------------------------*/
await initializeDatabase();

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});