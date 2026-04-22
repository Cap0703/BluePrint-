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
  document.getElementById('logRoomFilter').addEventListener('change', applyLogFilters);
  document.getElementById('logDateFilter').addEventListener('change', applyLogFilters);
  document.getElementById('assignPeriodsBtn').addEventListener('click', assignPeriodsToLogs);
  document.getElementById('assignStatusesBtn').addEventListener('click', assignStatusesToLogs);
  document.getElementById('csv').addEventListener('click', getLogsCsv);
  document.getElementById('pdf').addEventListener('click', downloadLogsPdf);
  document.getElementById('csvUploadBtn').addEventListener('click', () => csvUploadInput.click());
  document.getElementById('csvTemplateBtn').addEventListener('click', downloadLogsTemplate);
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
    populateLogRooms();
    populateLogDates();
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

function populateLogRooms() {
  const select = document.getElementById('logRoomFilter');
  const rooms = [...new Set(logState.allLogs.map(log => log.scanner_location).filter(Boolean))];
  select.innerHTML = '<option value="">All rooms</option>' + rooms.map(room => `<option value="${escapeHtml(room)}">${escapeHtml(room)}</option>`).join('');
}

function populateLogDates() {
  const input = document.getElementById('logDateFilter');
  const dates = [...new Set(logState.allLogs.map(log => normalizeDateValue(log.date_scanned)).filter(Boolean))];
  if (!input.value && dates.length) {
    input.max = dates[0];
  }
}

function applyLogFilters() {
  const search = document.getElementById('logSearch').value.trim().toLowerCase();
  const status = document.getElementById('logStatusFilter').value;
  const period = document.getElementById('logPeriodFilter').value;
  const room = document.getElementById('logRoomFilter').value;
  const date = document.getElementById('logDateFilter').value;

  logState.filteredLogs = logState.allLogs.filter(log => {
    const haystack = `${log.first_name || ''} ${log.last_name || ''} ${log.student_id || ''} ${log.scanner_location || ''} ${log.scanner_id || ''}`.toLowerCase();
    const searchMatch = !search || haystack.includes(search);
    const statusMatch = !status || normalizeStatus(log.status) === status;
    const periodMatch = !period || log.period === period;
    const roomMatch = !room || String(log.scanner_location || '') === room;
    const dateMatch = !date || normalizeDateValue(log.date_scanned) === date;
    return searchMatch && statusMatch && periodMatch && roomMatch && dateMatch;
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
    logData.date_scanned = getLocalDateString();
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
  if (!logState.filteredLogs.length) {
    alert('No logs are available to export.');
    return;
  }

  try {
    const csvContent = convertLogsToCsv(logState.filteredLogs);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = buildExportFileName('logs', 'csv');
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading CSV:', error);
    alert('Failed to download CSV');
  }
}

function downloadLogsPdf() {
  const logs = logState.filteredLogs;
  if (!logs.length) {
    alert('No logs are available to export.');
    return;
  }

  const printWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!printWindow) {
    alert('Unable to open the print window. Please allow pop-ups and try again.');
    return;
  }

  const generatedAt = new Date().toLocaleString();
  const filterSummary = getActiveFilterSummary();
  const logoUrl = `${window.location.origin}/css/logos/BluePrint_logo.png`;
  const statusBadgeClass = status => {
    const normalized = normalizeStatus(status).toLowerCase().replace(/\s+/g, '-');
    return `status-${normalized}`;
  };
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Master Logs PDF</title>
        <style>
          :root {
            --blueprint-navy: #08263b;
            --blueprint-ocean: #147dd3;
            --blueprint-sky: #14b1ff;
            --blueprint-ice: #e9f6ff;
            --blueprint-line: #c8dbea;
            --blueprint-text: #112133;
            --blueprint-muted: #587087;
            --blueprint-panel: rgba(255, 255, 255, 0.94);
          }
          * { box-sizing: border-box; }
          body {
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 28px;
            color: var(--blueprint-text);
            background:
              radial-gradient(circle at top left, rgba(20, 177, 255, 0.24), transparent 30%),
              linear-gradient(180deg, #eff8ff 0%, #ffffff 100%);
          }
          .report-shell {
            max-width: 1180px;
            margin: 0 auto;
          }
          .report-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 20px;
            padding: 22px 24px;
            border-radius: 18px;
            background: linear-gradient(135deg, var(--blueprint-sky), var(--blueprint-ocean) 55%, var(--blueprint-navy));
            color: #ffffff;
            box-shadow: 0 18px 38px rgba(8, 38, 59, 0.18);
            margin-bottom: 18px;
          }
          .brand-row {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .brand-logo {
            width: 72px;
            height: 72px;
            object-fit: contain;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.14);
            padding: 10px;
            border: 1px solid rgba(255, 255, 255, 0.22);
          }
          .brand-kicker {
            font-size: 11px;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            opacity: 0.82;
            margin-bottom: 8px;
          }
          h1 {
            margin: 0;
            font-size: 30px;
            line-height: 1.1;
          }
          .report-subtitle {
            margin-top: 8px;
            max-width: 620px;
            font-size: 13px;
            line-height: 1.55;
            color: rgba(255, 255, 255, 0.88);
          }
          .meta-card {
            min-width: 250px;
            padding: 14px 16px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.16);
            border: 1px solid rgba(255, 255, 255, 0.22);
            backdrop-filter: blur(8px);
          }
          .meta-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            opacity: 0.74;
            margin-bottom: 4px;
          }
          .meta-value {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 10px;
          }
          .filter-chip-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 0 0 14px;
          }
          .filter-chip {
            display: inline-flex;
            align-items: center;
            padding: 7px 10px;
            border-radius: 999px;
            background: rgba(20, 125, 211, 0.08);
            border: 1px solid rgba(20, 125, 211, 0.16);
            color: #0f4266;
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: 0.02em;
          }
          .table-card {
            background: var(--blueprint-panel);
            border: 1px solid rgba(20, 125, 211, 0.14);
            border-radius: 18px;
            overflow: hidden;
            box-shadow: 0 14px 30px rgba(17, 33, 51, 0.08);
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11.5px;
          }
          thead th {
            background: linear-gradient(180deg, #eef7ff 0%, #ddefff 100%);
            color: #0e3551;
            font-size: 10.5px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            border-bottom: 1px solid var(--blueprint-line);
          }
          th, td {
            padding: 10px 12px;
            text-align: left;
            vertical-align: top;
            border-bottom: 1px solid #e7eef5;
          }
          tbody tr:nth-child(even) {
            background: rgba(20, 125, 211, 0.035);
          }
          tbody tr:last-child td {
            border-bottom: none;
          }
          .student-name {
            font-weight: 600;
            color: #0f2740;
          }
          .muted {
            color: var(--blueprint-muted);
            font-size: 10.5px;
          }
          .status-pill {
            display: inline-block;
            padding: 4px 9px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            border: 1px solid transparent;
            white-space: nowrap;
          }
          .status-on-time {
            background: #e6f7ee;
            color: #16643c;
            border-color: #b8e4ca;
          }
          .status-late {
            background: #fff1dc;
            color: #8a4b00;
            border-color: #f3d29f;
          }
          .status-absent {
            background: #fde7e7;
            color: #9a1f1f;
            border-color: #f2b9b9;
          }
          .status-excused {
            background: #ede9ff;
            color: #5a35a5;
            border-color: #cec1ff;
          }
          .status-unknown {
            background: #edf2f7;
            color: #5f6f80;
            border-color: #d3dce5;
          }
          @media print {
            body {
              padding: 12px;
              background: #ffffff;
            }
            .report-header {
              box-shadow: none;
            }
            .table-card {
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="report-shell">
          <section class="report-header">
            <div>
              <div class="brand-row">
                <img class="brand-logo" src="${logoUrl}" alt="BluePrint logo">
                <div>
                  <div class="brand-kicker">BluePrint Attendance Report</div>
                  <h1>Master Logs</h1>
                  <div class="report-subtitle">Chronological attendance activity exported from the live operations view.</div>
                </div>
              </div>
            </div>
            <aside class="meta-card">
              <div class="meta-label">Generated</div>
              <div class="meta-value">${escapeHtml(generatedAt)}</div>
              <div class="meta-label">Visible Logs</div>
              <div class="meta-value">${escapeHtml(String(logs.length))}</div>
            </aside>
          </section>
          <div class="filter-chip-row">
            ${filterSummary.map(filter => `<span class="filter-chip">${escapeHtml(filter)}</span>`).join('')}
          </div>
          <section class="table-card">
            <table>
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
                </tr>
              </thead>
              <tbody>
                ${logs.map(log => `
                  <tr>
                    <td>${escapeHtml(log.date_scanned || '')}</td>
                    <td>${escapeHtml(normalizeLogTime(log.time_scanned) || '')}</td>
                    <td>
                      <div class="student-name">${escapeHtml(`${log.first_name || ''} ${log.last_name || ''}`.trim() || 'Unknown Student')}</div>
                    </td>
                    <td>${escapeHtml(log.student_id || '')}</td>
                    <td>
                      <div>${escapeHtml(log.period || 'Unassigned')}</div>
                    </td>
                    <td>
                      <div>${escapeHtml(log.scanner_location || 'Not recorded')}</div>
                    </td>
                    <td>
                      <div>${escapeHtml(log.scanner_id || 'Not recorded')}</div>
                    </td>
                    <td>
                      <span class="status-pill ${escapeHtml(statusBadgeClass(log.status))}">${escapeHtml(normalizeStatus(log.status))}</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </section>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
}

function convertLogsToCsv(logs) {
  const headers = [
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
    normalizeDateValue(log.date_scanned),
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

function escapeCsvValue(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  if (!/[",\n\r]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function downloadLogsTemplate() {
  downloadCsvRows([
    ['Date Scanned', 'Time Scanned', 'Student ID', 'First Name', 'Last Name', 'Period', 'Scanner Location', 'Scanner ID', 'Status'],
    ['2026-04-21', '11:59:49', '26115', 'John', 'Doe', 'Period 2', 'Room 101', 'SCN-01', 'on-time']
  ], 'master_logs_template.csv');
}

function downloadCsvRows(rows, fileName) {
  const csvContent = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
}

function buildExportFileName(prefix, extension) {
  const filters = getActiveFilters();
  const segments = [prefix];
  if (filters.date) segments.push(filters.date);
  if (filters.room) segments.push(slugify(filters.room));
  if (filters.period) segments.push(slugify(filters.period));
  return `${segments.join('_')}.${extension}`;
}

function getActiveFilters() {
  return {
    period: document.getElementById('logPeriodFilter').value,
    room: document.getElementById('logRoomFilter').value,
    date: document.getElementById('logDateFilter').value
  };
}

function getActiveFilterSummary() {
  const filters = getActiveFilters();
  const summary = [];
  summary.push(filters.room ? `Room: ${filters.room}` : 'Room: All');
  summary.push(filters.date ? `Date: ${filters.date}` : 'Date: All');
  summary.push(filters.period ? `Period: ${filters.period}` : 'Period: All');
  return summary;
}

function normalizeDateValue(value) {
  return String(value || '').trim();
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
