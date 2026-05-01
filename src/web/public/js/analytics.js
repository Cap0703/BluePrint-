/**
 * public/js/analytics.js
 * Responsible for loading attendance analytics data, rendering tables, and applying filters.
 * @ai-generated
 */
const analyticsState = {
  rows: [],
  filteredRows: []
};

document.addEventListener('DOMContentLoaded', initAnalyticsPage);

/**
 * Initializes the analytics page by fetching attendance analytics and wiring page controls.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function initAnalyticsPage() {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  try {
    const response = await fetch('/api/logs/analytics', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch analytics');
    }

    analyticsState.rows = (await response.json()).map(row => ({
      ...row,
      total: Number(row.total || 0)
    }));
    analyticsState.filteredRows = [...analyticsState.rows];

    populateAnalyticsFilters();
    bindAnalyticsFilters();
    renderAnalytics();
  } catch (error) {
    console.error('Failed to fetch analytics:', error);
    document.getElementById('analyticsTableBody').innerHTML = '<tr><td colspan="5">Unable to load analytics right now.</td></tr>';
  }
}

/**
 * Populates the analytics filter dropdowns for period and location.
 * @ai-generated
 * @returns {void}
 */
function populateAnalyticsFilters() {
  const periods = [...new Set(analyticsState.rows.map(row => row.period).filter(Boolean))];
  const rooms = [...new Set(analyticsState.rows.map(row => row.scanner_location).filter(Boolean))];

  document.getElementById('analyticsPeriodFilter').innerHTML += periods
    .map(period => `<option value="${escapeHtml(period)}">${escapeHtml(period)}</option>`)
    .join('');
  document.getElementById('analyticsLocationFilter').innerHTML += rooms
    .map(room => `<option value="${escapeHtml(room)}">${escapeHtml(room)}</option>`)
    .join('');
}

/**
 * Binds filter controls to the analytics filter handler.
 * @ai-generated
 * @returns {void}
 */
function bindAnalyticsFilters() {
  document.getElementById('analyticsSearch').addEventListener('input', applyAnalyticsFilters);
  document.getElementById('analyticsPeriodFilter').addEventListener('change', applyAnalyticsFilters);
  document.getElementById('analyticsLocationFilter').addEventListener('change', applyAnalyticsFilters);
}

/**
 * Applies search and dropdown filters against the cached analytics rows.
 * @ai-generated
 * @returns {void}
 */
function applyAnalyticsFilters() {
  const search = document.getElementById('analyticsSearch').value.trim().toLowerCase();
  const period = document.getElementById('analyticsPeriodFilter').value;
  const room = document.getElementById('analyticsLocationFilter').value;

  analyticsState.filteredRows = analyticsState.rows.filter(row => {
    const haystack = `${row.first_name || ''} ${row.last_name || ''} ${row.student_id || ''} ${row.scanner_location || ''} ${row.period || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesPeriod = !period || row.period === period;
    const matchesRoom = !room || row.scanner_location === room;
    return matchesSearch && matchesPeriod && matchesRoom;
  });

  renderAnalytics();
}

/**
 * Renders the full analytics dashboard including metrics, tables, and charts.
 * @ai-generated
 * @returns {void}
 */
function renderAnalytics() {
  renderAnalyticsMetrics();
  renderAnalyticsTable();
  renderTopCharts();
  renderTopStudents();
  document.getElementById('analyticsLastUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

/**
 * Summarizes filtered analytics into metric cards.
 * @ai-generated
 * @returns {void}
 */
function renderAnalyticsMetrics() {
  const rows = analyticsState.filteredRows;
  const totalScans = rows.reduce((sum, row) => sum + row.total, 0);
  const uniqueStudents = new Set(rows.map(row => row.student_id)).size;
  const mostActiveRoom = topEntry(rows, 'scanner_location');
  const busiestPeriod = topEntry(rows, 'period');

  const metrics = [
    { label: 'Total Scans', value: totalScans, footnote: 'Across the selected view' },
    { label: 'Unique Students', value: uniqueStudents, footnote: 'Distinct students represented' },
    { label: 'Top Room', value: mostActiveRoom.key || 'None', footnote: `${mostActiveRoom.total || 0} scans` },
    { label: 'Top Period', value: busiestPeriod.key || 'None', footnote: `${busiestPeriod.total || 0} scans` }
  ];

  document.getElementById('analyticsMetrics').innerHTML = metrics.map(metricCardMarkup).join('');
}

/**
 * Renders the analytics data table for the current filtered rows.
 * @ai-generated
 * @returns {void}
 */
function renderAnalyticsTable() {
  const tbody = document.getElementById('analyticsTableBody');
  if (!analyticsState.filteredRows.length) {
    tbody.innerHTML = '<tr><td colspan="5">No analytics rows match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = analyticsState.filteredRows
    .sort((a, b) => b.total - a.total)
    .map(row => `
      <tr>
        <td>${escapeHtml(`${row.first_name || ''} ${row.last_name || ''}`.trim())}</td>
        <td>${escapeHtml(row.student_id || '')}</td>
        <td>${escapeHtml(row.scanner_location || 'Unknown')}</td>
        <td>${escapeHtml(row.period || 'Unassigned')}</td>
        <td>${escapeHtml(String(row.total))}</td>
      </tr>
    `)
    .join('');
}

/**
 * Renders the top room and top period bar chart widgets.
 * @ai-generated
 * @returns {void}
 */
function renderTopCharts() {
  renderBarChart('topRoomsChart', aggregateRows(analyticsState.filteredRows, 'scanner_location'));
  renderBarChart('topPeriodsChart', aggregateRows(analyticsState.filteredRows, 'period'));
}

/**
 * Renders the top student activity list for the current analytics filters.
 * @ai-generated
 * @returns {void}
 */
function renderTopStudents() {
  const container = document.getElementById('topStudentsList');
  const byStudent = new Map();

  analyticsState.filteredRows.forEach(row => {
    const key = row.student_id || `${row.first_name}-${row.last_name}`;
    const current = byStudent.get(key) || {
      name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      total: 0,
      student_id: row.student_id
    };
    current.total += row.total;
    byStudent.set(key, current);
  });

  const topStudents = Array.from(byStudent.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  if (!topStudents.length) {
    container.innerHTML = '<div class="empty-state">No student activity found for the current filters.</div>';
    return;
  }

  container.innerHTML = topStudents.map(student => `
    <div class="list-card">
      <strong>${escapeHtml(student.name || 'Unknown')}</strong>
      <div class="muted">${escapeHtml(student.student_id || 'No student ID')} | ${student.total} scans</div>
    </div>
  `).join('');
}

/**
 * Renders a simple bar chart into the given container ID.
 * @ai-generated
 * @param {string} targetId - ID of the DOM element to render into.
 * @param {Array<{key:string,total:number}>} rows - The data rows to display.
 * @returns {void}
 */
function renderBarChart(targetId, rows) {
  const container = document.getElementById(targetId);
  const topRows = rows.slice(0, 5);
  if (!topRows.length) {
    container.innerHTML = '<div class="empty-state">No data available.</div>';
    return;
  }

  const max = topRows[0].total || 1;
  container.innerHTML = topRows.map(row => `
    <div class="bar-row">
      <div class="bar-label">
        <span>${escapeHtml(row.key || 'Unassigned')}</span>
        <span>${row.total}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max((row.total / max) * 100, 6)}%"></div>
      </div>
    </div>
  `).join('');
}

/**
 * Aggregates filtered analytics rows by the specified key.
 * @ai-generated
 * @param {Array<Object>} rows - The rows to aggregate.
 * @param {string} keyName - The object key to group by.
 * @returns {Array<{key:string,total:number}>}
 */
function aggregateRows(rows, keyName) {
  const totals = new Map();
  rows.forEach(row => {
    const key = row[keyName] || 'Unassigned';
    totals.set(key, (totals.get(key) || 0) + row.total);
  });
  return Array.from(totals.entries())
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Returns the top aggregated entry for a given dimension.
 * @ai-generated
 * @param {Array<Object>} rows - The rows to analyze.
 * @param {string} keyName - The dimension key to rank by.
 * @returns {{key:string|null,total:number}}
 */
function topEntry(rows, keyName) {
  return aggregateRows(rows, keyName)[0] || { key: null, total: 0 };
}

/**
 * Creates the HTML markup string for a metric card.
 * @ai-generated
 * @param {{label:string,value:number|string,footnote:string}} metric
 * @returns {string}
 */
function metricCardMarkup(metric) {
  return `
    <div class="metric-card glass-panel">
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <span class="metric-value">${escapeHtml(String(metric.value))}</span>
      <span class="metric-footnote">${escapeHtml(metric.footnote)}</span>
    </div>
  `;
}

/**
 * Escapes a string for safe insertion into HTML.
 * @ai-generated
 * @param {string|number} value - The value to escape.
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
