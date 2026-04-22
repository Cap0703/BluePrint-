const logState = {
  allLogs: [],
  filteredLogs: []
};

document.addEventListener('DOMContentLoaded', () => {
  bindLogUi();
  fetchLogs();
});

function bindLogUi() {
  const modal = document.getElementById('logModal');
  const openBtn = document.getElementById('addLogButton');
  const closeBtn = document.getElementById('closeModal');
  const form = document.getElementById('logForm');
  const csvUploadInput = document.getElementById('csvUploadInput');

  openBtn.addEventListener('click', () => {
    modal.style.display = 'block';
  });
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  window.addEventListener('click', event => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });

  form.addEventListener('submit', submitLogForm);
  document.getElementById('logSearch').addEventListener('input', applyLogFilters);
  document.getElementById('logStatusFilter').addEventListener('change', applyLogFilters);
  document.getElementById('logPeriodFilter').addEventListener('change', applyLogFilters);
  document.getElementById('assignPeriodsBtn').addEventListener('click', assignPeriodsToLogs);
  document.getElementById('assignStatusesBtn').addEventListener('click', assignStatusesToLogs);
  document.getElementById('csv').addEventListener('click', getLogsCsv);
  document.getElementById('csvUploadBtn').addEventListener('click', () => csvUploadInput.click());
  csvUploadInput.addEventListener('change', handleCsvUpload);
}

async function fetchLogs() {
  const token = localStorage.getItem('auth_token');
  try {
    const res = await fetch('/api/logs', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error('Failed to fetch logs');
    logState.allLogs = sortLogsChronologically(await res.json());
    logState.filteredLogs = [...logState.allLogs];
    populateLogPeriods();
    renderLogs();
    renderLogMetrics();
  } catch (err) {
    console.error('Failed to fetch logs:', err);
    document.getElementById('logsContent').innerHTML = '<div class="empty-state">Unable to load logs right now.</div>';
  }
}

function populateLogPeriods() {
  const select = document.getElementById('logPeriodFilter');
  const periods = [...new Set(logState.allLogs.map(log => log.period).filter(Boolean))];
  select.innerHTML = '<option value="">All periods</option>' + periods.map(period => `<option value="${escapeHtml(period)}">${escapeHtml(period)}</option>`).join('');
}

function applyLogFilters() {
  const search = document.getElementById('logSearch').value.trim().toLowerCase();
  const status = document.getElementById('logStatusFilter').value;
  const period = document.getElementById('logPeriodFilter').value;

  logState.filteredLogs = logState.allLogs.filter(log => {
    const haystack = `${log.first_name || ''} ${log.last_name || ''} ${log.student_id || ''} ${log.scanner_location || ''} ${log.scanner_id || ''}`.toLowerCase();
    const searchMatch = !search || haystack.includes(search);
    const statusMatch = !status || normalizeStatus(log.status) === status;
    const periodMatch = !period || log.period === period;
    return searchMatch && statusMatch && periodMatch;
  });
  logState.filteredLogs = sortLogsChronologically(logState.filteredLogs);

  renderLogs();
  renderLogMetrics();
}

function renderLogMetrics() {
  const logs = logState.filteredLogs;
  const metrics = [
    { label: 'Visible Logs', value: logs.length, footnote: 'Current filters applied' },
    { label: 'Unique Students', value: new Set(logs.map(log => log.student_id)).size, footnote: 'Distinct IDs in view' },
    { label: 'On Time', value: logs.filter(log => normalizeStatus(log.status) === 'On Time').length, footnote: 'Students marked on time' },
    { label: 'Late', value: logs.filter(log => normalizeStatus(log.status) === 'Late').length, footnote: 'Students marked late' }
  ];

  document.getElementById('logMetrics').innerHTML = metrics.map(metricCardMarkup).join('');
}

function renderLogs() {
  const container = document.getElementById('logsContent');
  const logs = logState.filteredLogs;
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state">No logs match the current filters.</div>';
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
            <th>Period</th>
            <th>Location</th>
            <th>Scanner</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>${escapeHtml(log.date_scanned || '')}</td>
              <td>${escapeHtml(log.time_scanned || '')}</td>
              <td>${escapeHtml(`${log.first_name || ''} ${log.last_name || ''}`.trim())}</td>
              <td>${escapeHtml(log.student_id || '')}</td>
              <td>${escapeHtml(log.period || 'Unassigned')}</td>
              <td>${escapeHtml(log.scanner_location || '')}</td>
              <td>${escapeHtml(log.scanner_id || '')}</td>
              <td><span class="status-pill ${statusClass(log.status)}">${normalizeStatus(log.status)}</span></td>
              <td><button class="delete-btn" data-log-id="${log.id}">Delete</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('.delete-btn').forEach(button => {
    button.addEventListener('click', () => deleteLog(button.dataset.logId));
  });
}

async function submitLogForm(event) {
  event.preventDefault();
  const token = localStorage.getItem('auth_token');
  const form = document.getElementById('logForm');
  const formData = new FormData(form);
  const logData = Object.fromEntries(formData.entries());

  if (!logData.time_scanned) {
    logData.time_scanned = new Date().toLocaleTimeString('en-US', { hour12: false });
  }
  if (!logData.date_scanned) {
    logData.date_scanned = new Date().toISOString().split('T')[0];
  }

  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(logData)
    });

    if (!res.ok) {
      const error = await res.json();
      alert(error.error || 'Failed to create log entry');
      return;
    }

    document.getElementById('logModal').style.display = 'none';
    form.reset();
    fetchLogs();
  } catch (err) {
    console.error('Failed to add log:', err);
    alert('Server error while creating log');
  }
}

async function deleteLog(id) {
  if (!confirm('Delete this log entry?')) return;
  const token = localStorage.getItem('auth_token');
  try {
    const res = await fetch(`/api/logs/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      throw new Error('Delete failed');
    }
    fetchLogs();
  } catch (err) {
    console.error('Failed to delete log:', err);
    alert('Unable to delete log entry.');
  }
}

async function assignPeriodsToLogs() {
  await postLogMaintenance('/api/logs/assign-periods', 'Periods assigned successfully.');
}

async function assignStatusesToLogs() {
  await postLogMaintenance('/api/logs/assign-statuses', 'Statuses assigned successfully.');
}

async function postLogMaintenance(url, successMessage) {
  const token = localStorage.getItem('auth_token');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Operation failed');
      return;
    }
    alert(successMessage);
    fetchLogs();
  } catch (err) {
    console.error(err);
    alert('Server error');
  }
}

function normalizeStatus(status) {
  const value = String(status || 'Unknown').toLowerCase();
  if (value === 'on-time') return 'On Time';
  if (value === 'ontime') return 'On Time';
  if (value === 'on time') return 'On Time';
  if (value === 'late') return 'Late';
  if (value === 'absent') return 'Absent';
  if (value === 'excused') return 'Excused';
  return 'Unknown';
}

function statusClass(status) {
  return normalizeStatus(status).toLowerCase().replace(/\s+/g, '-');
}

function metricCardMarkup(metric) {
  return `
    <div class="metric-card glass-panel">
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <span class="metric-value">${escapeHtml(String(metric.value))}</span>
      <span class="metric-footnote">${escapeHtml(metric.footnote)}</span>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getLogsCsv() {
  const token = localStorage.getItem('auth_token');
  fetch('/api/logs/csv', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  .then(response => response.blob())
  .then(blob => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'logs.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  })
  .catch(error => {
    console.error('Error downloading CSV:', error);
    alert('Failed to download CSV');
  });
}

async function handleCsvUpload(event) {
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
    fetchLogs();
  } catch (error) {
    console.error('Failed to upload CSV:', error);
    alert(error.message || 'Failed to upload CSV');
  } finally {
    event.target.value = '';
  }
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
    scanner_id: pickCsvValue(row, ['scanner_id', 'scannerid', 'device_id', 'device']),
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
