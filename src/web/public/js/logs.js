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
    logState.allLogs = await res.json();
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
