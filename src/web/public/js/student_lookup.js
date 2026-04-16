const lookupState = {
  results: [],
  logs: [],
  timer: null
};

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('studentLookupInput');
  input.addEventListener('input', () => {
    clearTimeout(lookupState.timer);
    lookupState.timer = setTimeout(() => performLookup(input.value.trim()), 200);
  });
});

async function performLookup(query) {
  const container = document.getElementById('studentLookupResults');
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  if (!query) {
    container.innerHTML = '<div class="empty-state">Start typing to search for a student.</div>';
    return;
  }

  container.innerHTML = '<div class="loading-state-panel">Searching students...</div>';

  try {
    const [studentRes, logsRes] = await Promise.all([
      fetch(`/api/students/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch('/api/logs', {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    lookupState.results = studentRes.ok ? await studentRes.json() : [];
    lookupState.logs = logsRes.ok ? await logsRes.json() : [];
    renderLookupResults(query);
  } catch (error) {
    console.error('Student lookup failed:', error);
    container.innerHTML = '<div class="empty-state">Unable to complete the student lookup right now.</div>';
  }
}

function renderLookupResults(query) {
  const container = document.getElementById('studentLookupResults');
  const normalizedQuery = query.toLowerCase();
  const logMatches = groupLogOnlyMatches(normalizedQuery);
  const combined = mergeStudentResults(logMatches);

  if (!combined.length) {
    container.innerHTML = '<div class="empty-state">No matching students were found.</div>';
    return;
  }

  container.innerHTML = combined.map(result => {
    const recentLogs = result.logs.slice(0, 5);
    const latest = recentLogs[0];
    return `
      <article class="result-card glass-panel">
        <div class="result-header">
          <div>
            <h3>${escapeHtml(result.first_name || 'Unknown')} ${escapeHtml(result.last_name || '')}</h3>
            <div class="result-meta">
              <span class="pill">Student ID ${escapeHtml(result.student_id || 'Unknown')}</span>
              <span class="pill">${result.logs.length} scan${result.logs.length === 1 ? '' : 's'}</span>
              ${latest ? `<span class="pill">Last seen ${escapeHtml(latest.date_scanned || '')}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="detail-grid">
          <div class="list-card">
            <div class="muted">Directory Status</div>
            <strong>${result.id ? 'Student account found' : 'Seen in log history only'}</strong>
          </div>
          <div class="list-card">
            <div class="muted">Latest Location</div>
            <strong>${escapeHtml(latest?.scanner_location || 'No location recorded')}</strong>
          </div>
          <div class="list-card">
            <div class="muted">Latest Period</div>
            <strong>${escapeHtml(latest?.period || 'Unassigned')}</strong>
          </div>
          <div class="list-card">
            <div class="muted">Latest Status</div>
            <strong>${escapeHtml(normalizeStatus(latest?.status))}</strong>
          </div>
        </div>
        <div class="panel-title" style="margin-top: 1rem;">
          <h3>Recent Attendance</h3>
        </div>
        <div class="activity-feed">
          ${recentLogs.length ? recentLogs.map(log => `
            <div class="activity-item">
              <strong>${escapeHtml(log.date_scanned || 'Unknown date')} at ${escapeHtml(log.time_scanned || 'Unknown time')}</strong>
              <div class="muted">Room ${escapeHtml(log.scanner_location || 'Unknown')} | ${escapeHtml(log.period || 'Unassigned period')} | ${escapeHtml(normalizeStatus(log.status))}</div>
            </div>
          `).join('') : '<div class="empty-state" style="padding: 1rem;">No attendance records were found.</div>'}
        </div>
      </article>
    `;
  }).join('');
}

function groupLogOnlyMatches(query) {
  const grouped = new Map();
  lookupState.logs.forEach(log => {
    const haystack = `${log.student_id || ''} ${log.first_name || ''} ${log.last_name || ''}`.toLowerCase();
    if (!haystack.includes(query)) return;
    const key = String(log.student_id || `${log.first_name}-${log.last_name}`);
    if (!grouped.has(key)) {
      grouped.set(key, {
        student_id: log.student_id,
        first_name: log.first_name,
        last_name: log.last_name,
        logs: []
      });
    }
    grouped.get(key).logs.push(log);
  });

  return Array.from(grouped.values()).map(entry => ({
    ...entry,
    logs: entry.logs.sort(sortLogsDesc)
  }));
}

function mergeStudentResults(logMatches) {
  const map = new Map();

  lookupState.results.forEach(student => {
    map.set(String(student.student_id), {
      ...student,
      logs: []
    });
  });

  logMatches.forEach(match => {
    const key = String(match.student_id || '');
    if (!map.has(key)) {
      map.set(key, match);
      return;
    }
    const existing = map.get(key);
    existing.logs = [...existing.logs, ...match.logs].sort(sortLogsDesc);
  });

  return Array.from(map.values()).sort((a, b) => {
    const aLogs = a.logs?.length || 0;
    const bLogs = b.logs?.length || 0;
    return bLogs - aLogs;
  });
}

function sortLogsDesc(a, b) {
  const left = `${a.date_scanned || ''} ${a.time_scanned || ''}`;
  const right = `${b.date_scanned || ''} ${b.time_scanned || ''}`;
  return right.localeCompare(left);
}

function normalizeStatus(status) {
  const value = String(status || 'Unknown').toLowerCase();
  if (value === 'on-time') return 'On Time';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
