const dashboardState = {
  token: localStorage.getItem('auth_token'),
  user: null,
  logs: [],
  courses: [],
  students: [],
  scopedLogs: [],
  scopedCourses: [],
  filters: {
    search: '',
    classKey: '',
    date: localDateString()
  }
};

document.addEventListener('DOMContentLoaded', initDashboard);

async function initDashboard() {
  if (!dashboardState.token) {
    window.location.href = '/login';
    return;
  }

  bindDashboardFilters();
  document.getElementById('dashboardDateFilter').value = dashboardState.filters.date;

  try {
    dashboardState.user = await fetchJson('/api/auth/me');

    const [logs, courses, students] = await Promise.all([
      fetchJson('/api/logs'),
      fetchJson('/api/courses'),
      dashboardState.user.role === 'administrator' ? fetchJson('/api/students') : Promise.resolve([])
    ]);

    dashboardState.logs = Array.isArray(logs) ? logs : [];
    dashboardState.courses = Array.isArray(courses) ? courses : [];
    dashboardState.students = Array.isArray(students) ? students : [];
    dashboardState.scopedCourses = scopeCourses();
    dashboardState.scopedLogs = scopeLogs();

    populateDashboardFilters();
    renderDashboard();
  } catch (error) {
    console.error('Failed to load dashboard:', error);
    renderDashboardError();
  }
}

function bindDashboardFilters() {
  document.getElementById('dashboardSearch').addEventListener('input', event => {
    dashboardState.filters.search = event.target.value.trim().toLowerCase();
    renderDashboard();
  });

  document.getElementById('dashboardClassFilter').addEventListener('change', event => {
    dashboardState.filters.classKey = event.target.value;
    renderDashboard();
  });

  document.getElementById('dashboardDateFilter').addEventListener('change', event => {
    dashboardState.filters.date = event.target.value || localDateString();
    renderDashboard();
  });
}

function populateDashboardFilters() {
  const select = document.getElementById('dashboardClassFilter');
  const courseOptions = dashboardState.scopedCourses
    .map(course => ({ key: courseKey(course), label: `${course.room} | ${course.period}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const fallbackOptions = uniqueCourseKeys(dashboardState.scopedLogs)
    .filter(option => !courseOptions.some(course => course.key === option.key));

  const options = [...courseOptions, ...fallbackOptions];
  select.innerHTML = '<option value="">All classes</option>' + options
    .map(option => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`)
    .join('');
}

function renderDashboard() {
  const filteredLogs = filterLogs();
  const selectedDateLogs = filteredLogs.filter(log => normalizeDate(log.date_scanned) === dashboardState.filters.date);
  const allSelectedScopeLogs = dashboardState.scopedLogs.filter(log => {
    const matchesClass = !dashboardState.filters.classKey || logCourseKey(log) === dashboardState.filters.classKey;
    const matchesSearch = matchesLogSearch(log, dashboardState.filters.search);
    return matchesClass && matchesSearch;
  });

  renderHeader();
  renderSummary(selectedDateLogs);
  renderQuickActions();
  renderAlerts(selectedDateLogs, allSelectedScopeLogs);
  renderTrends(allSelectedScopeLogs);
  renderActivity(selectedDateLogs);
  renderClassSnapshot(selectedDateLogs);
  renderFilterSummary(selectedDateLogs, allSelectedScopeLogs);
  renderRoleFocus(selectedDateLogs, allSelectedScopeLogs);
}

function renderHeader() {
  const user = dashboardState.user;
  const isAdmin = user.role === 'administrator';
  const rolePill = document.getElementById('dashboardRolePill');
  const title = document.getElementById('dashboardTitle');
  const subtitle = document.getElementById('dashboardSubtitle');

  rolePill.textContent = isAdmin ? 'Administrator view' : 'Teacher view';
  title.textContent = isAdmin ? 'School Attendance Command Center' : 'Your Attendance Dashboard';
  subtitle.textContent = isAdmin
    ? 'Start with the students and classes that need attention, then jump directly into reports, logs, and class coverage.'
    : 'Keep your classes moving with today\'s attendance snapshot, quick actions, and a focused list of students who need follow-up.';
}

function renderSummary(dayLogs) {
  const counts = countStatuses(dayLogs);
  const presentCount = counts['On Time'];
  const tardyCount = counts.Late;
  const absentCount = counts.Absent;
  const excusedCount = counts.Excused;
  const accounted = presentCount + tardyCount + absentCount + excusedCount;
  const attendanceRate = accounted ? Math.round(((presentCount + tardyCount + excusedCount) / accounted) * 100) : 0;
  const totalStudents = dashboardState.user.role === 'administrator'
    ? dashboardState.students.length
    : uniqueStudentCount(dayLogs);
  const classesTracked = new Set(dayLogs.map(logCourseKey).filter(Boolean)).size;

  document.getElementById('summaryHeadline').textContent = attendanceRate >= 90
    ? 'Attendance is holding strong across the current view.'
    : attendanceRate >= 75
      ? 'A few attendance issues need attention today.'
      : 'Attendance follow-up should be the first priority right now.';

  document.getElementById('summaryNarrative').textContent = `${presentCount} present, ${absentCount} absent, and ${tardyCount} tardy for ${friendlyDate(dashboardState.filters.date)}.${excusedCount ? ` ${excusedCount} students are marked excused.` : ''}`;
  document.getElementById('attendanceRateValue').textContent = `${attendanceRate}%`;
  document.getElementById('summaryLegend').innerHTML = [
    legendMarkup('Present', presentCount, 'present'),
    legendMarkup('Absent', absentCount, 'absent'),
    legendMarkup('Tardy', tardyCount, 'tardy')
  ].join('');
  document.getElementById('summaryQuickStats').innerHTML = [
    quickStatMarkup(dashboardState.user.role === 'administrator' ? 'Total students' : 'Students seen', totalStudents),
    quickStatMarkup('Classes tracked', classesTracked),
    quickStatMarkup('Logs in scope', dayLogs.length)
  ].join('');
  document.getElementById('summaryMetrics').innerHTML = [
    metricCardMarkup('Present', presentCount, 'Students marked on time'),
    metricCardMarkup('Absent', absentCount, 'Students needing follow-up'),
    metricCardMarkup('Tardy', tardyCount, 'Late arrivals in view'),
    metricCardMarkup('Attendance rate', `${attendanceRate}%`, accounted ? 'Based on today\'s visible statuses' : 'No attendance records for this date')
  ].join('');

  renderAttendanceDonut({
    present: presentCount,
    absent: absentCount,
    tardy: tardyCount,
    excused: excusedCount
  });
}

function renderAttendanceDonut(counts) {
  const total = counts.present + counts.absent + counts.tardy + counts.excused;
  const presentPct = total ? (counts.present / total) * 100 : 0;
  const absentPct = total ? (counts.absent / total) * 100 : 0;
  const tardyPct = total ? (counts.tardy / total) * 100 : 0;
  const excusedPct = total ? (counts.excused / total) * 100 : 0;

  const donut = document.getElementById('attendanceDonut');
  donut.style.background = `conic-gradient(
    #68d391 0 ${presentPct}%,
    #ff8f8f ${presentPct}% ${presentPct + absentPct}%,
    #ffd166 ${presentPct + absentPct}% ${presentPct + absentPct + tardyPct}%,
    #7dc8ff ${presentPct + absentPct + tardyPct}% ${presentPct + absentPct + tardyPct + excusedPct}%,
    rgba(255, 255, 255, 0.12) ${presentPct + absentPct + tardyPct + excusedPct}% 100%
  )`;
}

function renderQuickActions() {
  const isAdmin = dashboardState.user.role === 'administrator';
  const actions = [
    {
      title: 'Take Attendance',
      description: isAdmin ? 'Jump straight into active class coverage.' : 'Open your live attendance workflow.',
      href: '/room',
      tone: 'primary'
    },
    {
      title: 'Edit Today\'s Attendance',
      description: isAdmin ? 'Review and correct today\'s attendance records.' : 'Review class scans and clean up today\'s entries.',
      href: isAdmin ? '/master_logs' : '/room',
      tone: 'secondary'
    },
    {
      title: 'Add Student',
      description: isAdmin ? 'Create or update student records.' : 'Student records are managed by administrators.',
      href: isAdmin ? '/app_settings' : '/app_settings',
      tone: isAdmin ? 'secondary' : 'disabled',
      disabled: !isAdmin
    },
    {
      title: 'Generate Report',
      description: isAdmin ? 'Open analytics and reporting views.' : 'Review attendance trends for your classes.',
      href: '/analytics',
      tone: 'secondary'
    }
  ];

  document.getElementById('quickActionGrid').innerHTML = actions.map(action => `
    <a class="action-tile ${escapeHtml(action.tone)}${action.disabled ? ' is-disabled' : ''}" href="${action.disabled ? '#' : escapeHtml(action.href)}"${action.disabled ? ' aria-disabled="true"' : ''}>
      <strong>${escapeHtml(action.title)}</strong>
      <span>${escapeHtml(action.description)}</span>
    </a>
  `).join('');
}

function renderAlerts(dayLogs, scopedLogs) {
  const excessiveAbsences = topAbsenceCounts(scopedLogs).filter(entry => entry.total > 5).slice(0, 5);
  const consecutiveAbsences = findConsecutiveAbsenceStreaks(scopedLogs).slice(0, 5);
  const unexcusedToday = dayLogs.filter(log => normalizeStatus(log.status) === 'Absent').slice(0, 6);
  const tardyToday = dayLogs.filter(log => normalizeStatus(log.status) === 'Late').slice(0, 6);

  const alertGroups = [
    {
      title: 'Excessive absences',
      tone: 'critical',
      summary: excessiveAbsences.length ? `${excessiveAbsences.length} students have more than 5 absences.` : 'No students crossed the absence threshold.',
      items: excessiveAbsences.map(entry => `${entry.name} | ${entry.total} absences`)
    },
    {
      title: 'Consecutive absences',
      tone: 'warning',
      summary: consecutiveAbsences.length ? `${consecutiveAbsences.length} students show an active absence streak.` : 'No consecutive absence streaks detected.',
      items: consecutiveAbsences.map(entry => `${entry.name} | ${entry.streak} straight days ending ${friendlyDate(entry.lastDate)}`)
    },
    {
      title: 'Unexcused absences today',
      tone: 'critical',
      summary: unexcusedToday.length ? `${unexcusedToday.length} students are absent in the selected day view.` : 'No absences are showing for this day.',
      items: unexcusedToday.map(log => `${studentName(log)} | ${classLabelFromLog(log)}`)
    },
    {
      title: 'Late arrivals today',
      tone: 'notice',
      summary: tardyToday.length ? `${tardyToday.length} late arrivals need review.` : 'No late arrivals in the current view.',
      items: tardyToday.map(log => `${studentName(log)} | ${classLabelFromLog(log)} at ${formatTime(log.time_scanned)}`)
    }
  ];

  const totalFlags = excessiveAbsences.length + consecutiveAbsences.length + unexcusedToday.length + tardyToday.length;
  document.getElementById('alertsPill').textContent = totalFlags ? `${totalFlags} active flags` : 'Nothing urgent right now';

  document.getElementById('dashboardAlerts').innerHTML = alertGroups.map(group => `
    <article class="alert-card ${escapeHtml(group.tone)}">
      <h3>${escapeHtml(group.title)}</h3>
      <p>${escapeHtml(group.summary)}</p>
      <div class="alert-items">
        ${group.items.length ? group.items.map(item => `<div class="alert-item">${escapeHtml(item)}</div>`).join('') : '<div class="alert-item muted">No students listed.</div>'}
      </div>
    </article>
  `).join('');
}

function renderTrends(scopedLogs) {
  renderWeeklyTrend(scopedLogs);
  renderBarChart('absentClassesChart', aggregateFilteredLogs(scopedLogs.filter(log => normalizeStatus(log.status) === 'Absent'), log => classLabelFromLog(log)));
  renderBarChart('weekdayPatternChart', aggregateFilteredLogs(scopedLogs, log => weekdayLabel(log.date_scanned)));
}

function renderWeeklyTrend(scopedLogs) {
  const target = document.getElementById('weeklyTrendChart');
  const lastSevenDates = getTrailingDates(dashboardState.filters.date, 7);
  const dayRows = lastSevenDates.map(date => {
    const logs = scopedLogs.filter(log => normalizeDate(log.date_scanned) === date);
    const counts = countStatuses(logs);
    const accounted = counts['On Time'] + counts.Late + counts.Absent + counts.Excused;
    const rate = accounted ? Math.round(((counts['On Time'] + counts.Late + counts.Excused) / accounted) * 100) : 0;
    return { date, rate, total: logs.length };
  });

  if (!dayRows.some(row => row.total > 0)) {
    target.innerHTML = '<div class="empty-state">Not enough attendance history to show a weekly trend yet.</div>';
    return;
  }

  target.innerHTML = dayRows.map(row => `
    <div class="trend-column">
      <span class="trend-value">${row.rate}%</span>
      <div class="trend-bar-track">
        <div class="trend-bar-fill" style="height:${Math.max(row.rate, 8)}%"></div>
      </div>
      <span class="trend-label">${escapeHtml(shortDate(row.date))}</span>
    </div>
  `).join('');
}

function renderActivity(dayLogs) {
  const feed = document.getElementById('activityFeed');
  const recentLogs = [...dayLogs]
    .sort((a, b) => compareDateTime(b.date_scanned, b.time_scanned, a.date_scanned, a.time_scanned))
    .slice(0, 8);

  document.getElementById('activityPill').textContent = recentLogs.length ? `Updated ${new Date().toLocaleTimeString()}` : 'No activity yet';

  if (!recentLogs.length) {
    feed.innerHTML = '<div class="empty-state">No attendance activity is available for the selected filters.</div>';
    return;
  }

  feed.innerHTML = recentLogs.map(log => `
    <div class="activity-item">
      <strong>${escapeHtml(studentName(log))}</strong> marked <strong>${escapeHtml(normalizeStatus(log.status))}</strong> in ${escapeHtml(classLabelFromLog(log))}
      <div class="muted">${escapeHtml(friendlyDate(log.date_scanned))} at ${escapeHtml(formatTime(log.time_scanned))}</div>
    </div>
  `).join('');
}

function renderClassSnapshot(dayLogs) {
  const target = document.getElementById('classSnapshotList');
  const snapshotCourses = dashboardState.scopedCourses.length
    ? dashboardState.scopedCourses
    : uniqueCourseKeys(dayLogs).map(entry => ({
        room: entry.room,
        period: entry.period
      }));

  const rows = snapshotCourses.map(course => {
    const classLogs = dayLogs.filter(log => logCourseKey(log) === courseKey(course));
    const counts = countStatuses(classLogs);
    const accounted = counts['On Time'] + counts.Late + counts.Absent + counts.Excused;
    const rate = accounted ? Math.round(((counts['On Time'] + counts.Late + counts.Excused) / accounted) * 100) : 0;
    return {
      label: `${course.room} | ${course.period}`,
      rate,
      taken: classLogs.length > 0,
      total: classLogs.length,
      summary: classLogs.length
        ? `${counts['On Time']} present, ${counts.Absent} absent, ${counts.Late} tardy`
        : 'No attendance submitted yet'
    };
  });

  document.getElementById('classSnapshotPill').textContent = `${rows.length} classes in scope`;

  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">No classes are assigned to this dashboard view yet.</div>';
    return;
  }

  target.innerHTML = rows.map(row => `
    <div class="snapshot-card">
      <div>
        <strong>${escapeHtml(row.label)}</strong>
        <div class="muted">${escapeHtml(row.summary)}</div>
      </div>
      <div class="snapshot-meta">
        <span class="status-pill ${row.taken ? 'on-time' : 'unknown'}">${row.taken ? 'Taken' : 'Not Taken'}</span>
        <span class="snapshot-rate">${row.taken ? `${row.rate}%` : '--'}</span>
        <a class="snapshot-link" href="/room">Open</a>
      </div>
    </div>
  `).join('');
}

function renderFilterSummary(dayLogs, scopedLogs) {
  const filterBits = [
    dashboardState.filters.search ? `search "${dashboardState.filters.search}"` : 'no search term',
    dashboardState.filters.classKey ? `class ${classLabelFromKey(dashboardState.filters.classKey)}` : 'all classes',
    `date ${friendlyDate(dashboardState.filters.date)}`
  ];

  document.getElementById('filterSummary').textContent = `${dayLogs.length} visible records on ${friendlyDate(dashboardState.filters.date)} with ${filterBits.join(', ')}. ${scopedLogs.length} total records remain in the broader filtered scope.`;
}

function renderRoleFocus(dayLogs, scopedLogs) {
  const isAdmin = dashboardState.user.role === 'administrator';
  const title = document.getElementById('roleFocusTitle');
  const pill = document.getElementById('roleFocusPill');
  const list = document.getElementById('roleFocusList');

  if (isAdmin) {
    title.textContent = 'Administrator Priorities';
    pill.textContent = 'School-wide view';
    const missingClasses = dashboardState.scopedCourses.filter(course => !dayLogs.some(log => logCourseKey(log) === courseKey(course)));
    list.innerHTML = [
      roleCardMarkup('Reports and alerts', 'School-wide metrics, flags, and trend summaries are surfaced above for faster review.'),
      roleCardMarkup('Attendance coverage', `${missingClasses.length} classes in scope have not submitted attendance for ${friendlyDate(dashboardState.filters.date)}.`),
      roleCardMarkup('Operational load', `${uniqueStudentCount(scopedLogs)} students appear across the current dataset.`)
    ].join('');
    return;
  }

  title.textContent = 'Teacher Priorities';
  pill.textContent = 'Classroom-focused';
  const tardyToday = dayLogs.filter(log => normalizeStatus(log.status) === 'Late').length;
  const absentToday = dayLogs.filter(log => normalizeStatus(log.status) === 'Absent').length;
  list.innerHTML = [
    roleCardMarkup('Classes assigned', `${dashboardState.scopedCourses.length} classes are connected to your dashboard scope.`),
    roleCardMarkup('Students needing follow-up', `${absentToday} absent and ${tardyToday} tardy students are visible in today's class view.`),
    roleCardMarkup('Next step', dayLogs.length ? 'Use Edit Today\'s Attendance to clean up anything that looks off before the day closes.' : 'Start with Take Attendance so your classes are marked as covered.')
  ].join('');
}

function renderDashboardError() {
  document.getElementById('summaryHeadline').textContent = 'The dashboard could not load right now.';
  document.getElementById('summaryNarrative').textContent = 'Please refresh the page or check that the server is available.';
  document.getElementById('summaryLegend').innerHTML = '';
  document.getElementById('summaryQuickStats').innerHTML = quickStatMarkup('Status', 'Error');
  document.getElementById('summaryMetrics').innerHTML = metricCardMarkup('Dashboard', 'Unavailable', 'There was a problem loading attendance data');
  document.getElementById('quickActionGrid').innerHTML = '<div class="empty-state">Quick actions will appear when data loads successfully.</div>';
  document.getElementById('dashboardAlerts').innerHTML = '<div class="empty-state">Alerts could not be calculated.</div>';
  document.getElementById('weeklyTrendChart').innerHTML = '<div class="empty-state">Trend data unavailable.</div>';
  document.getElementById('absentClassesChart').innerHTML = '<div class="empty-state">Trend data unavailable.</div>';
  document.getElementById('weekdayPatternChart').innerHTML = '<div class="empty-state">Trend data unavailable.</div>';
  document.getElementById('activityFeed').innerHTML = '<div class="empty-state">Recent activity unavailable.</div>';
  document.getElementById('classSnapshotList').innerHTML = '<div class="empty-state">Class snapshot unavailable.</div>';
  document.getElementById('roleFocusList').innerHTML = '<div class="empty-state">Role focus unavailable.</div>';
}

function filterLogs() {
  return dashboardState.scopedLogs.filter(log => {
    const matchesClass = !dashboardState.filters.classKey || logCourseKey(log) === dashboardState.filters.classKey;
    return matchesClass && matchesLogSearch(log, dashboardState.filters.search);
  });
}

function matchesLogSearch(log, search) {
  if (!search) return true;
  const haystack = `${log.first_name || ''} ${log.last_name || ''} ${log.student_id || ''}`.toLowerCase();
  return haystack.includes(search);
}

function scopeCourses() {
  return [...dashboardState.courses];
}

function scopeLogs() {
  return [...dashboardState.logs];
}

function countStatuses(logs) {
  return logs.reduce((counts, log) => {
    counts[normalizeStatus(log.status)] += 1;
    return counts;
  }, {
    'On Time': 0,
    Late: 0,
    Absent: 0,
    Excused: 0,
    Unknown: 0
  });
}

function topAbsenceCounts(logs) {
  const totals = new Map();
  logs
    .filter(log => normalizeStatus(log.status) === 'Absent')
    .forEach(log => {
      const key = log.student_id || studentName(log);
      const current = totals.get(key) || { name: studentName(log), total: 0 };
      current.total += 1;
      totals.set(key, current);
    });

  return Array.from(totals.values()).sort((a, b) => b.total - a.total);
}

function findConsecutiveAbsenceStreaks(logs) {
  const byStudent = new Map();
  logs
    .filter(log => normalizeStatus(log.status) === 'Absent')
    .forEach(log => {
      const key = log.student_id || studentName(log);
      const current = byStudent.get(key) || { name: studentName(log), dates: new Set() };
      current.dates.add(normalizeDate(log.date_scanned));
      byStudent.set(key, current);
    });

  return Array.from(byStudent.values()).map(entry => {
    const dates = Array.from(entry.dates).sort();
    let best = 1;
    let current = 1;

    for (let index = 1; index < dates.length; index += 1) {
      if (daysBetween(dates[index - 1], dates[index]) === 1) {
        current += 1;
        best = Math.max(best, current);
      } else {
        current = 1;
      }
    }

    return {
      name: entry.name,
      streak: best,
      lastDate: dates[dates.length - 1]
    };
  }).filter(entry => entry.streak > 1).sort((a, b) => b.streak - a.streak);
}

function renderBarChart(targetId, rows) {
  const container = document.getElementById(targetId);
  const topRows = rows.slice(0, 5);

  if (!topRows.length) {
    container.innerHTML = '<div class="empty-state">No data available for this view.</div>';
    return;
  }

  const max = topRows[0].total || 1;
  container.innerHTML = topRows.map(row => `
    <div class="bar-row">
      <div class="bar-label">
        <span>${escapeHtml(row.key || 'Unknown')}</span>
        <span>${row.total}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max((row.total / max) * 100, 8)}%"></div>
      </div>
    </div>
  `).join('');
}

function aggregateFilteredLogs(logs, keyBuilder) {
  const totals = new Map();
  logs.forEach(log => {
    const key = keyBuilder(log) || 'Unknown';
    totals.set(key, (totals.get(key) || 0) + 1);
  });

  return Array.from(totals.entries())
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.total - a.total);
}

function uniqueCourseKeys(logs) {
  const map = new Map();
  logs.forEach(log => {
    const key = logCourseKey(log);
    if (!key || map.has(key)) return;
    map.set(key, {
      key,
      label: classLabelFromLog(log),
      room: log.scanner_location || 'Unknown room',
      period: log.period || 'Unassigned'
    });
  });
  return Array.from(map.values());
}

function courseKey(course) {
  return `${course.room || 'Unknown room'}__${course.period || 'Unassigned'}`;
}

function logCourseKey(log) {
  return `${log.scanner_location || 'Unknown room'}__${log.period || 'Unassigned'}`;
}

function classLabelFromLog(log) {
  return `${log.scanner_location || 'Unknown room'} | ${log.period || 'Unassigned'}`;
}

function classLabelFromKey(key) {
  return key.replace('__', ' | ');
}

function studentName(log) {
  const fullName = `${log.first_name || ''} ${log.last_name || ''}`.trim();
  return fullName || log.student_id || 'Unknown student';
}

function uniqueStudentCount(logs) {
  return new Set(logs.map(log => log.student_id || studentName(log))).size;
}

function normalizeStatus(status) {
  const value = String(status || 'Unknown').trim().toLowerCase();
  if (value === 'on-time' || value === 'on time' || value === 'ontime') return 'On Time';
  if (value === 'late') return 'Late';
  if (value === 'absent') return 'Absent';
  if (value === 'excused') return 'Excused';
  return 'Unknown';
}

function weekdayLabel(date) {
  if (!date) return 'Unknown';
  const parsed = new Date(`${normalizeDate(date)}T00:00:00`);
  return parsed.toLocaleDateString(undefined, { weekday: 'short' });
}

function localDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().split('T')[0];
}

function normalizeDate(date) {
  if (!date) return '';
  return String(date).slice(0, 10);
}

function friendlyDate(date) {
  if (!date) return 'Unknown date';
  return new Date(`${normalizeDate(date)}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function shortDate(date) {
  if (!date) return '';
  return new Date(`${normalizeDate(date)}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

function formatTime(value) {
  if (!value) return '--';
  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length >= 2) {
      const date = new Date();
      date.setHours(Number(parts[0]), Number(parts[1]), Number(parts[2] || 0), 0);
      return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
  }
  return value;
}

function getTrailingDates(endDate, totalDays) {
  const end = new Date(`${normalizeDate(endDate)}T00:00:00`);
  const dates = [];
  for (let index = totalDays - 1; index >= 0; index -= 1) {
    const current = new Date(end);
    current.setDate(end.getDate() - index);
    dates.push(localIsoFromDate(current));
  }
  return dates;
}

function localIsoFromDate(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().split('T')[0];
}

function compareDateTime(dateA, timeA, dateB, timeB) {
  const first = new Date(`${normalizeDate(dateA)}T${timeA || '00:00:00'}`).getTime();
  const second = new Date(`${normalizeDate(dateB)}T${timeB || '00:00:00'}`).getTime();
  return first - second;
}

function daysBetween(dateA, dateB) {
  const first = new Date(`${normalizeDate(dateA)}T00:00:00`);
  const second = new Date(`${normalizeDate(dateB)}T00:00:00`);
  return Math.round((second - first) / 86400000);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${dashboardState.token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}`);
  }

  return response.json();
}

function quickStatMarkup(label, value) {
  return `
    <div class="dashboard-stat-chip">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function legendMarkup(label, value, tone) {
  return `
    <div class="legend-item ${escapeHtml(tone)}">
      <span class="legend-dot"></span>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function roleCardMarkup(title, body) {
  return `
    <div class="list-card">
      <strong>${escapeHtml(title)}</strong>
      <div class="muted">${escapeHtml(body)}</div>
    </div>
  `;
}

function metricCardMarkup(label, value, footnote) {
  return `
    <div class="metric-card glass-panel">
      <span class="metric-label">${escapeHtml(label)}</span>
      <span class="metric-value">${escapeHtml(String(value))}</span>
      <span class="metric-footnote">${escapeHtml(footnote)}</span>
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
