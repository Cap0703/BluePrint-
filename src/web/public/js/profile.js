const profileState = {
  user: null,
  courses: [],
  logs: []
};

document.addEventListener('DOMContentLoaded', loadProfilePage);

async function loadProfilePage() {
  const token = getTokenOrRedirect();
  if (!token) return;

  try {
    const [userRes, coursesRes, logsRes] = await Promise.all([
      fetch('/api/auth/me', authOptions(token)),
      fetch('/api/courses', authOptions(token)),
      fetch('/api/logs', authOptions(token))
    ]);

    if (!userRes.ok) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
      return;
    }

    profileState.user = await userRes.json();
    profileState.courses = coursesRes.ok ? await coursesRes.json() : [];
    profileState.logs = logsRes.ok ? await logsRes.json() : [];

    renderProfile();
  } catch (error) {
    console.error('Failed to load profile page:', error);
    document.getElementById('profileActivity').innerHTML = '<div class="empty-state">Unable to load profile data right now.</div>';
  }
}

function renderProfile() {
  const user = profileState.user;
  const courseIds = (user.courses || []).map(Number);
  const assignedCourses = profileState.courses.filter(course => courseIds.includes(Number(course.id)));
  const roomNames = new Set(assignedCourses.map(course => String(course.room)));
  const relatedLogs = user.role === 'teacher'
    ? profileState.logs.filter(log => roomNames.has(String(log.scanner_location)))
    : profileState.logs;

  document.getElementById('profileName').textContent = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown User';
  document.getElementById('profileEmail').textContent = user.email || 'No email on file';
  document.getElementById('profileRole').textContent = normalizeRole(user.role);
  document.getElementById('profileCreatedAt').textContent = formatDate(user.created_at);

  const metrics = [
    {
      label: 'Assigned Courses',
      value: assignedCourses.length,
      footnote: assignedCourses.length ? 'Linked to your classroom coverage' : 'No course assignments yet'
    },
    {
      label: 'Related Scans',
      value: relatedLogs.length,
      footnote: user.role === 'teacher' ? 'Scans in your assigned rooms' : 'Scans visible to your account'
    },
    {
      label: 'Rooms Covered',
      value: roomNames.size || 0,
      footnote: roomNames.size ? Array.from(roomNames).slice(0, 3).join(', ') : 'No rooms linked yet'
    }
  ];

  document.getElementById('profileMetrics').innerHTML = metrics.map(metricCardMarkup).join('');

  const coursesContainer = document.getElementById('profileCourses');
  if (!assignedCourses.length) {
    coursesContainer.innerHTML = '<div class="empty-state">No courses are assigned to this account yet.</div>';
  } else {
    coursesContainer.innerHTML = assignedCourses.map(course => `
      <div class="list-card">
        <strong>Room ${escapeHtml(course.room)}</strong>
        <div class="muted">${escapeHtml(course.period)}</div>
      </div>
    `).join('');
  }

  /*const recentLogs = relatedLogs.slice(0, 8);
  const activityContainer = document.getElementById('profileActivity');
  if (!recentLogs.length) {
    activityContainer.innerHTML = '<div class="empty-state">No attendance activity has been recorded yet.</div>';
    return;
  }

  activityContainer.innerHTML = recentLogs.map(log => `
    <div class="activity-item">
      <strong>${escapeHtml(log.first_name || 'Unknown')} ${escapeHtml(log.last_name || '')}</strong>
      <div class="muted">${escapeHtml(log.student_id || 'No student ID')} | Room ${escapeHtml(log.scanner_location || 'Unknown')} | ${escapeHtml(log.period || 'Unassigned period')}</div>
      <div class="muted">${formatDate(log.date_scanned)} at ${escapeHtml(log.time_scanned || 'Unknown time')} | ${normalizeStatus(log.status)}</div>
    </div>
  `).join('');*/
}

function normalizeRole(role) {
  if (!role) return 'Unknown';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function normalizeStatus(status) {
  const normalized = String(status || 'Unknown').toLowerCase();
  if (normalized === 'on-time') return 'On Time';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

function authOptions(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
}

function getTokenOrRedirect() {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/login';
    return null;
  }
  return token;
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
