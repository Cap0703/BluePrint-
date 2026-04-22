const teacherLogsState = {
  logs: [],
  filteredLogs: [],
  courses: []
};

document.addEventListener('DOMContentLoaded', initTeacherLogsPage);

async function initTeacherLogsPage() {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  bindTeacherLogFilters();

  try {
    await fetchTeacherLogData();
  } catch (error) {
    console.error('Failed to load teacher logs:', error);
    document.getElementById('teacherLogsContent').innerHTML = '<div class="empty-state">Unable to load your class logs right now.</div>';
  }
}

function bindTeacherLogFilters() {
  document.getElementById('teacherLogSearch').addEventListener('input', applyTeacherLogFilters);
  document.getElementById('teacherRoomFilter').addEventListener('change', applyTeacherLogFilters);
  document.getElementById('teacherPeriodFilter').addEventListener('change', applyTeacherLogFilters);
  document.getElementById('teacherDateFilter').addEventListener('change', applyTeacherLogFilters);

  const modal = document.getElementById('teacherLogModal');
  document.getElementById('teacherAddLogButton').addEventListener('click', () => {
    modal.style.display = 'block';
  });
  document.getElementById('closeTeacherLogModal').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  window.addEventListener('click', event => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });

  document.getElementById('teacherLogForm').addEventListener('submit', submitTeacherLogForm);
  document.getElementById('teacherCsvUploadBtn').addEventListener('click', () => {
    document.getElementById('teacherCsvUploadInput').click();
  });
  document.getElementById('teacherCsvUploadInput').addEventListener('change', handleTeacherCsvUpload);
  document.getElementById('teacherCsvTemplateBtn').addEventListener('click', downloadTeacherLogsTemplate);
  document.getElementById('teacherCsvDownloadBtn').addEventListener('click', downloadTeacherLogsCsv);
}

async function fetchTeacherLogData() {
  const token = localStorage.getItem('auth_token');
  const [logsRes, coursesRes] = await Promise.all([
    fetch('/api/logs', { headers: { Authorization: `Bearer ${token}` } }),
    fetch('/api/courses', { headers: { Authorization: `Bearer ${token}` } })
  ]);

  teacherLogsState.logs = logsRes.ok ? sortLogsChronologically(await logsRes.json()) : [];
  teacherLogsState.filteredLogs = [...teacherLogsState.logs];
  teacherLogsState.courses = coursesRes.ok ? await coursesRes.json() : [];

  populateTeacherLogFilters();
  populateTeacherCourseOptions();
  renderTeacherLogs();
  renderTeacherLogMetrics();
}

function populateTeacherLogFilters() {
  const roomSelect = document.getElementById('teacherRoomFilter');
  const periodSelect = document.getElementById('teacherPeriodFilter');

  const rooms = [...new Set(teacherLogsState.courses.map(course => course.room).filter(Boolean))];
  const periods = [...new Set(teacherLogsState.courses.map(course => course.period).filter(Boolean))];

  roomSelect.innerHTML = '<option value="">All assigned rooms</option>' + rooms.map(room => `<option value="${escapeHtml(room)}">${escapeHtml(room)}</option>`).join('');
  periodSelect.innerHTML = '<option value="">All assigned periods</option>' + periods.map(period => `<option value="${escapeHtml(period)}">${escapeHtml(period)}</option>`).join('');
}

function populateTeacherCourseOptions() {
  const select = document.getElementById('teacherAssignedCourse');
  const options = teacherLogsState.courses.map(course => `
    <option value="${escapeHtml(courseScopeKey(course.room, course.period))}">
      ${escapeHtml(`Room ${course.room} - ${course.period}`)}
    </option>
  `).join('');

  select.innerHTML = '<option value="">Select an assigned class...</option>' + options;

  if (teacherLogsState.courses.length === 1) {
    select.value = courseScopeKey(teacherLogsState.courses[0].room, teacherLogsState.courses[0].period);
  }
}

function applyTeacherLogFilters() {
  const search = document.getElementById('teacherLogSearch').value.trim().toLowerCase();
  const room = document.getElementById('teacherRoomFilter').value;
  const period = document.getElementById('teacherPeriodFilter').value;
  const date = document.getElementById('teacherDateFilter').value;

  teacherLogsState.filteredLogs = sortLogsChronologically(teacherLogsState.logs.filter(log => {
    const haystack = `${log.first_name || ''} ${log.last_name || ''} ${log.student_id || ''} ${log.scanner_location || ''} ${log.period || ''}`.toLowerCase();
    const searchMatch = !search || haystack.includes(search);
    const roomMatch = !room || String(log.scanner_location || '') === room;
    const periodMatch = !period || String(log.period || '') === period;
    const dateMatch = !date || String(log.date_scanned || '') === date;
    return searchMatch && roomMatch && periodMatch && dateMatch;
  }));

  renderTeacherLogs();
  renderTeacherLogMetrics();
}

function renderTeacherLogMetrics() {
  const logs = teacherLogsState.filteredLogs;
  const metrics = [
    { label: 'Visible Logs', value: logs.length, footnote: 'Current class filters applied' },
    { label: 'Assigned Classes', value: teacherLogsState.courses.length, footnote: 'Room and period pairs linked to your account' },
    { label: 'Unique Students', value: new Set(logs.map(log => log.student_id)).size, footnote: 'Students in the current view' },
    { label: 'Late', value: logs.filter(log => normalizeStatus(log.status) === 'Late').length, footnote: 'Late attendance records in scope' }
  ];

  document.getElementById('teacherLogMetrics').innerHTML = metrics.map(metric => `
    <div class="metric-card glass-panel">
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <span class="metric-value">${escapeHtml(String(metric.value))}</span>
      <span class="metric-footnote">${escapeHtml(metric.footnote)}</span>
    </div>
  `).join('');
}

function renderTeacherLogs() {
  const container = document.getElementById('teacherLogsContent');
  const logs = teacherLogsState.filteredLogs;

  if (!logs.length) {
    container.innerHTML = '<div class="empty-state">No logs match your assigned class filters.</div>';
    return;
  }

  container.innerHTML = `
    <div class="table-shell">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Student</th>
            <th>Student ID</th>
            <th>Room</th>
            <th>Period</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>${escapeHtml(log.date_scanned || '')}</td>
              <td>${escapeHtml(normalizeLogTime(log.time_scanned) || '')}</td>
              <td>${escapeHtml(`${log.first_name || ''} ${log.last_name || ''}`.trim())}</td>
              <td>${escapeHtml(log.student_id || '')}</td>
              <td>${escapeHtml(log.scanner_location || '')}</td>
              <td>${escapeHtml(log.period || '')}</td>
              <td><span class="status-pill ${statusClass(log.status)}">${escapeHtml(normalizeStatus(log.status))}</span></td>
              <td><button class="delete-btn" data-log-id="${escapeHtml(String(log.id))}">Delete</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteTeacherLog(button.dataset.logId));
  });
}

async function submitTeacherLogForm(event) {
  event.preventDefault();
  const token = localStorage.getItem('auth_token');
  const form = document.getElementById('teacherLogForm');
  const formData = Object.fromEntries(new FormData(form).entries());
  const selectedCourse = parseCourseScopeKey(formData.class_key);

  if (!selectedCourse.room || !selectedCourse.period) {
    alert('Choose one of your assigned classes before submitting a log.');
    return;
  }

  const payload = {
    student_id: formData.student_id,
    first_name: formData.first_name,
    last_name: formData.last_name,
    status: formData.status,
    time_scanned: formData.time_scanned || new Date().toLocaleTimeString('en-US', { hour12: false }),
    date_scanned: formData.date_scanned || getLocalDateString(),
    scanner_location: selectedCourse.room,
    period: selectedCourse.period
  };

  try {
    const response = await fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create log entry');
    }

    form.reset();
    populateTeacherCourseOptions();
    document.getElementById('teacherLogModal').style.display = 'none';
    await fetchTeacherLogData();
  } catch (error) {
    console.error('Failed to create teacher log:', error);
    alert(error.message || 'Failed to create log entry');
  }
}

async function deleteTeacherLog(logId) {
  if (!confirm('Delete this log entry from your class view?')) return;

  const token = localStorage.getItem('auth_token');
  try {
    const response = await fetch(`/api/logs/${logId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete log entry');
    }

    await fetchTeacherLogData();
  } catch (error) {
    console.error('Failed to delete teacher log:', error);
    alert(error.message || 'Failed to delete log entry');
  }
}

async function handleTeacherCsvUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const text = await file.text();
    const parsedRows = parseCsv(text);
    if (!parsedRows.length) {
      alert('The selected CSV is empty.');
      return;
    }

    const logs = parsedRows
      .map(mapCsvRowToLog)
      .filter(log => Object.values(log).some(value => value));

    if (!logs.length) {
      alert('No valid log rows were found in the CSV.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    const response = await fetch('/api/logs/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ logs })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'CSV upload failed');
    }

    alert(`Uploaded ${data.inserted || logs.length} log entries.`);
    await fetchTeacherLogData();
  } catch (error) {
    console.error('Failed to upload teacher CSV:', error);
    alert(error.message || 'Failed to upload CSV');
  } finally {
    event.target.value = '';
  }
}

function downloadTeacherLogsTemplate() {
  const exampleCourse = teacherLogsState.courses[0] || { room: '202', period: 'Period 1' };
  downloadCsvRows([
    ['Date Scanned', 'Time Scanned', 'Student ID', 'First Name', 'Last Name', 'Period', 'Scanner Location', 'Status'],
    ['2026-04-21', '08:00:00', '26115', 'John', 'Doe', exampleCourse.period, exampleCourse.room, 'on-time']
  ], 'teacher_logs_template.csv');
}

function downloadTeacherLogsCsv() {
  if (!teacherLogsState.filteredLogs.length) {
    alert('No logs are available to export.');
    return;
  }

  const csvContent = convertLogsToCsv(teacherLogsState.filteredLogs);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  link.download = buildTeacherExportFileName();
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
}

function convertLogsToCsv(logs) {
  const headers = ['ID', 'Date Scanned', 'Time Scanned', 'Student ID', 'First Name', 'Last Name', 'Period', 'Scanner Location', 'Scanner ID', 'Status'];
  const rows = logs.map(log => [
    log.id,
    String(log.date_scanned || '').trim(),
    normalizeLogTime(log.time_scanned),
    log.student_id,
    log.first_name,
    log.last_name,
    log.period,
    log.scanner_location,
    log.scanner_id,
    normalizeStatus(log.status)
  ]);

  return [headers, ...rows]
    .map(row => row.map(escapeCsvValue).join(','))
    .join('\n');
}

function buildTeacherExportFileName() {
  const room = document.getElementById('teacherRoomFilter').value;
  const period = document.getElementById('teacherPeriodFilter').value;
  const date = document.getElementById('teacherDateFilter').value;
  const segments = ['teacher_logs'];
  if (date) segments.push(date);
  if (room) segments.push(slugify(room));
  if (period) segments.push(slugify(period));
  return `${segments.join('_')}.csv`;
}

function courseScopeKey(room, period) {
  return `${String(room || '').trim()}__${String(period || '').trim()}`;
}

function parseCourseScopeKey(value) {
  const [room = '', period = ''] = String(value || '').split('__');
  return { room, period };
}

function normalizeStatus(status) {
  const value = String(status || 'Unknown').trim().toLowerCase();
  if (value === 'on-time' || value === 'on time' || value === 'ontime') return 'On Time';
  if (value === 'late') return 'Late';
  if (value === 'absent') return 'Absent';
  if (value === 'excused') return 'Excused';
  return 'Unknown';
}

function statusClass(status) {
  return normalizeStatus(status).toLowerCase().replace(/\s+/g, '-');
}

function parseCsv(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      if (row.some(cell => String(cell).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some(cell => String(cell).trim() !== '')) {
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return [];
  const headers = headerRow.map(normalizeCsvHeader);

  return dataRows.map(columns => {
    const mapped = {};
    headers.forEach((header, idx) => {
      mapped[header] = String(columns[idx] ?? '').trim();
    });
    return mapped;
  });
}

function mapCsvRowToLog(row) {
  return {
    first_name: pickCsvValue(row, ['first_name', 'firstname', 'first']),
    last_name: pickCsvValue(row, ['last_name', 'lastname', 'last']),
    student_id: pickCsvValue(row, ['student_id', 'studentid', 'id']),
    period: pickCsvValue(row, ['period']),
    scanner_location: pickCsvValue(row, ['scanner_location', 'location', 'room', 'scanner']),
    status: pickCsvValue(row, ['status']),
    time_scanned: pickCsvValue(row, ['time_scanned', 'timescanned', 'time', 'scan_time']),
    date_scanned: pickCsvValue(row, ['date_scanned', 'datescanned', 'date', 'scan_date'])
  };
}

function pickCsvValue(row, keys) {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return '';
}

function normalizeCsvHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function downloadCsvRows(rows, fileName) {
  const csvContent = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
}

function escapeCsvValue(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  if (!/[",\n\r]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function sortLogsChronologically(logs) {
  return [...logs].sort(compareLogsChronologically);
}

function compareLogsChronologically(left, right) {
  const timestampDiff = getLogTimestampValue(right) - getLogTimestampValue(left);
  if (timestampDiff !== 0) return timestampDiff;
  return Number(right?.id || 0) - Number(left?.id || 0);
}

function getLogTimestampValue(log) {
  const date = String(log?.date_scanned || '').trim();
  const time = normalizeLogTime(log?.time_scanned);
  if (!date || !time) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(`${date}T${time}`);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function normalizeLogTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const timeOnly = raw.includes(' ') ? raw.split(' ').pop() : raw;
  const twelveHourMatch = timeOnly.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = twelveHourMatch[2];
    const seconds = twelveHourMatch[3] || '00';
    const meridiem = twelveHourMatch[4].toUpperCase();
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
  }

  const twentyFourHourMatch = timeOnly.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!twentyFourHourMatch) return timeOnly;
  return `${String(twentyFourHourMatch[1]).padStart(2, '0')}:${twentyFourHourMatch[2]}:${twentyFourHourMatch[3] || '00'}`;
}

function getLocalDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
