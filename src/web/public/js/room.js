const roomState = {
  roomName: '',
  logs: [],
  filteredLogs: [],
  courses: []
};

document.addEventListener('DOMContentLoaded', initRoomPage);

async function initRoomPage() {
  const roomName = new URLSearchParams(window.location.search).get('room_name') || 'Unknown';
  roomState.roomName = roomName;
  document.getElementById('room-info').textContent = `Room ${roomName}`;

  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  try {
    const [logsRes, coursesRes] = await Promise.all([
      fetch(`/api/logs/${encodeURIComponent(roomName)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch('/api/courses', {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    roomState.logs = logsRes.ok ? await logsRes.json() : [];
    roomState.filteredLogs = [...roomState.logs];
    roomState.courses = coursesRes.ok ? await coursesRes.json() : [];

    setupRoomFilters();
    renderRoomPage();
  } catch (error) {
    console.error('Failed to load room page:', error);
    document.getElementById('roomLogs').innerHTML = '<div class="empty-state">Unable to load room data.</div>';
  }
}

function setupRoomFilters() {
  const periodFilter = document.getElementById('roomPeriodFilter');
  const periods = [...new Set(roomState.logs.map(log => log.period).filter(Boolean))];
  periodFilter.innerHTML = '<option value="">All periods</option>' + periods.map(period => `<option value="${escapeHtml(period)}">${escapeHtml(period)}</option>`).join('');
  periodFilter.addEventListener('change', applyRoomFilters);
  document.getElementById('roomDateFilter').addEventListener('change', applyRoomFilters);
}

function applyRoomFilters() {
  const period = document.getElementById('roomPeriodFilter').value;
  const date = document.getElementById('roomDateFilter').value;
  roomState.filteredLogs = roomState.logs.filter(log => {
    const periodMatch = !period || String(log.period || '') === period;
    const dateMatch = !date || String(log.date_scanned || '') === date;
    return periodMatch && dateMatch;
  });
  renderRoomLogs();
  renderRoomMetrics();
}

function renderRoomPage() {
  renderRoomDetails();
  renderRoomMetrics();
  renderRoomActivity();
  renderRoomLogs();
}

function renderRoomDetails() {
  const matchingCourses = roomState.courses.filter(course => String(course.room) === String(roomState.roomName));
  const latestLog = roomState.logs[0];
  document.getElementById('room-subtitle').textContent = matchingCourses.length
    ? `Configured for ${matchingCourses.map(course => course.period).join(', ')}.`
    : 'No course assignments were found for this room yet.';

  const detailItems = [
    ['Configured Periods', matchingCourses.length ? matchingCourses.map(course => course.period).join(', ') : 'None configured'],
    ['Total Logs', String(roomState.logs.length)],
    ['Latest Scan', latestLog ? `${formatDate(latestLog.date_scanned)} at ${latestLog.time_scanned || 'Unknown time'}` : 'No scans yet'],
    ['Unique Students', String(new Set(roomState.logs.map(log => log.student_id)).size)]
  ];

  document.getElementById('roomDetails').innerHTML = detailItems.map(([label, value]) => `
    <div class="list-card">
      <div class="muted">${escapeHtml(label)}</div>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

function renderRoomMetrics() {
  const logs = roomState.filteredLogs;
  const today = new Date().toISOString().split('T')[0];
  const todayLogs = roomState.logs.filter(log => log.date_scanned === today);
  const onTimeCount = logs.filter(log => normalizeStatus(log.status) === 'On Time').length;
  const lateCount = logs.filter(log => normalizeStatus(log.status) === 'Late').length;
  const metrics = [
    { label: 'Visible Logs', value: logs.length, footnote: 'Current filters applied' },
    { label: 'Today', value: todayLogs.length, footnote: 'Entries recorded today' },
    { label: 'On Time', value: onTimeCount, footnote: 'Students marked on time' },
    { label: 'Late', value: lateCount, footnote: 'Students marked late' }
  ];
  document.getElementById('roomMetrics').innerHTML = metrics.map(metricCardMarkup).join('');
}

function renderRoomActivity() {
  const today = new Date().toISOString().split('T')[0];
  const activity = roomState.logs.filter(log => log.date_scanned === today).slice(0, 8);
  const container = document.getElementById('roomActivityFeed');
  if (!activity.length) {
    container.innerHTML = '<div class="empty-state">No room activity has been recorded today.</div>';
    return;
  }

  container.innerHTML = activity.map(log => `
    <div class="activity-item">
      <strong>${escapeHtml(log.first_name || 'Unknown')} ${escapeHtml(log.last_name || '')}</strong>
      <div class="muted">${escapeHtml(log.student_id || 'No student ID')} | ${escapeHtml(log.period || 'Unassigned period')}</div>
      <div class="muted">${escapeHtml(log.time_scanned || 'Unknown time')} | ${normalizeStatus(log.status)}</div>
    </div>
  `).join('');
}

function renderRoomLogs() {
  const container = document.getElementById('roomLogs');
  const logs = roomState.filteredLogs;
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state">No logs match the current room filters.</div>';
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
            <th>Status</th>
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
              <td><span class="status-pill ${statusClass(log.status)}">${normalizeStatus(log.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
