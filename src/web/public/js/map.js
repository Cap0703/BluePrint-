/**
 * public/js/map.js
 * Handles the current class map editor, room and scanner data loading, and UI refresh logic.
 * @ai-generated
 */
let deleteMode = false;
let selectedRoomId = null;

const mapData = {
  rooms: [],
  scanners: []
};

const mapContext = {
  logs: [],
  courses: [],
  calendar: null
};

document.addEventListener('DOMContentLoaded', async () => {
  bindMapControls();
  reloadLevel();
  await Promise.all([loadMap(), loadMapContext()]);
  mapData.rooms.forEach(room => refreshRoomCard(room));
  renderSelectedRoom();
  renderMapMetrics();
  renderRoomList();
});

/**
 * Binds controls for map editing actions such as add room, save, layer navigation, and delete mode.
 * @ai-generated
 * @returns {void}
 */
function bindMapControls() {
  document.getElementById('addRoomButton').addEventListener('click', () => {
    createRoom(document.getElementById('roomName').value, getCurrentLayer());
  });
  document.getElementById('saveMapButton').addEventListener('click', saveMap);
  document.getElementById('deleteModeBtn').addEventListener('click', toggleDeleteMode);
  document.getElementById('upLayerButton').addEventListener('click', upLayer);
  document.getElementById('downLayerButton').addEventListener('click', downLayer);
}

/**
 * Reloads the current map layer display and updates visible room elements.
 * @ai-generated
 * @returns {void}
 */
function reloadLevel() {
  const layerEl = document.getElementById('currentMapLayer');
  const z = parseInt(layerEl.dataset.z || '0', 10);
  layerEl.dataset.z = String(z);
  layerEl.textContent = String(z);
  updateLayerVisibility();
}

/**
 * Moves the map view to the next higher layer.
 * @ai-generated
 * @returns {void}
 */
function upLayer() {
  const layerEl = document.getElementById('currentMapLayer');
  layerEl.dataset.z = String((parseInt(layerEl.dataset.z || '0', 10)) + 1);
  reloadLevel();
}

/**
 * Moves the map view to the next lower layer.
 * @ai-generated
 * @returns {void}
 */
function downLayer() {
  const layerEl = document.getElementById('currentMapLayer');
  layerEl.dataset.z = String((parseInt(layerEl.dataset.z || '0', 10)) - 1);
  reloadLevel();
}

/**
 * Returns the currently selected map layer index.
 * @ai-generated
 * @returns {number}
 */
function getCurrentLayer() {
  return parseInt(document.getElementById('currentMapLayer').dataset.z || '0', 10);
}

/**
 * Updates visibility for rooms based on the active map layer.
 * @ai-generated
 * @returns {void}
 */
function updateLayerVisibility() {
  const currentLayer = getCurrentLayer();
  document.querySelectorAll('.room').forEach(room => {
    const roomLayer = parseInt(room.dataset.layer, 10);
    room.style.opacity = roomLayer === currentLayer ? '1' : '0.18';
    room.style.pointerEvents = roomLayer === currentLayer ? 'auto' : 'none';
  });
}

/**
 * Toggles delete mode for room removal.
 * @ai-generated
 * @returns {void}
 */
function toggleDeleteMode() {
  deleteMode = !deleteMode;
  document.getElementById('deleteModeBtn').textContent = deleteMode ? 'Exit Delete Mode' : 'Delete Mode';
}

/**
 * Creates a new draggable room block on the map.
 * @ai-generated
 * @param {string} name - Room label.
 * @param {number} z - Map layer index.
 * @returns {void}
 */
function createRoom(name, z) {
  if (!name || !name.trim()) {
    alert('Please enter a room name.');
    return;
  }

  const room = {
    id: `room_${Date.now()}`,
    name: name.trim(),
    students: '',
    z,
    x: 80 + (mapData.rooms.length % 4) * 220,
    y: 80 + Math.floor(mapData.rooms.length / 4) * 170,
    width: 200,
    height: 140
  };
  mapData.rooms.push(room);
  renderRoom(room);
  renderRoomList();
  renderMapMetrics();
  document.getElementById('roomName').value = '';
}

/**
 * Renders a room element into the map canvas.
 * @ai-generated
 * @param {Object} room - Room data object.
 * @returns {void}
 */
function renderRoom(room) {
  const map = document.getElementById('mapCanvas');
  const div = document.createElement('div');
  div.className = 'room';
  div.dataset.id = room.id;
  div.dataset.layer = String(room.z);
  div.dataset.dragged = 'false';
  div.style.left = `${room.x}px`;
  div.style.top = `${room.y}px`;
  div.style.width = `${room.width}px`;
  div.style.height = `${room.height}px`;
  div.innerHTML = roomMarkup(room);

  div.addEventListener('click', () => {
    if (deleteMode) {
      div.remove();
      mapData.rooms = mapData.rooms.filter(entry => entry.id !== room.id);
      if (selectedRoomId === room.id) {
        selectedRoomId = null;
      }
      renderRoomList();
      renderSelectedRoom();
      renderMapMetrics();
      return;
    }

    if (div.dataset.dragged === 'true') {
      div.dataset.dragged = 'false';
      return;
    }

    selectedRoomId = room.id;
    renderRoomList();
    renderSelectedRoom();
    window.location.href = `/room?room_name=${encodeURIComponent(room.name)}`;
  });

  enableRoomDrag(div, room);
  map.appendChild(div);
  updateLayerVisibility();
}

/**
 * Builds HTML markup for a room tile tooltip and summary.
 * @ai-generated
 * @param {Object} room - Room data object.
 * @returns {string}
 */
function roomMarkup(room) {
  const todayStudents = getTodayRoomStudents(room.name);
  const currentStudents = getCurrentRoomStudents(room.name);
  const courses = mapContext.courses.filter(course => String(course.room) === String(room.name));
  const currentPeriod = getCurrentPeriodTitle();
  const currentPeriodLogs = mapContext.logs.filter(log =>
    log.date_scanned === getTodayDate() &&
    String(log.scanner_location) === String(room.name) &&
    currentPeriod &&
    String(log.period || '') === String(currentPeriod)
  );
  const lateCount = currentPeriodLogs.filter(log => normalizeStatus(log.status) === 'Late').length;

  return `
    <div class="room-header">${escapeHtml(room.name)}</div>
    <div class="room-content" style="padding:8px;display:grid;gap:0.35rem;">
      <div style="font-size:0.85rem;">${currentStudents.length} currently in class</div>
      <div style="font-size:0.8rem;opacity:0.9;">${todayStudents.length} student${todayStudents.length === 1 ? '' : 's'} seen today</div>
      <div style="font-size:0.8rem;opacity:0.85;">Layer ${room.z}</div>
    </div>
    <div class="room-hover-card">
      <strong>${escapeHtml(room.name)} quick stats</strong>
      <div class="room-hover-grid">
        <div>
          <span>Current</span>
          <b>${currentStudents.length}</b>
        </div>
        <div>
          <span>Today</span>
          <b>${todayStudents.length}</b>
        </div>
        <div>
          <span>Late now</span>
          <b>${lateCount}</b>
        </div>
        <div>
          <span>Periods</span>
          <b>${courses.length ? escapeHtml(courses.map(course => course.period).join(', ')) : 'None'}</b>
        </div>
      </div>
      <div class="room-hover-link">Click to open room details</div>
    </div>
  `;
}

/**
 * Enables drag behavior for a room element.
 * @ai-generated
 * @param {HTMLElement} el - Room DOM element.
 * @param {Object} room - Room data model to update while dragging.
 * @returns {void}
 */
function enableRoomDrag(el, room) {
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  el.addEventListener('mousedown', event => {
    dragging = true;
    offsetX = event.offsetX;
    offsetY = event.offsetY;
    startX = event.clientX;
    startY = event.clientY;
    el.dataset.dragged = 'false';
    event.stopPropagation();
  });

  document.addEventListener('mousemove', event => {
    if (!dragging) return;
    if (Math.abs(event.clientX - startX) > 4 || Math.abs(event.clientY - startY) > 4) {
      el.dataset.dragged = 'true';
    }
    const rect = document.getElementById('mapCanvas').getBoundingClientRect();
    room.x = event.clientX - rect.left - offsetX;
    room.y = event.clientY - rect.top - offsetY;
    el.style.left = `${room.x}px`;
    el.style.top = `${room.y}px`;
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
  });
}

/**
 * Renders scanner dots onto the map canvas.
 * @ai-generated
 * @returns {void}
 */
function renderScanners() {
  const map = document.getElementById('mapCanvas');
  mapData.scanners.forEach(scanner => {
    const dot = document.createElement('div');
    dot.className = 'scanner-dot';
    dot.title = scanner.scanner_id || scanner.id;
    dot.style.left = `${scanner.x || 20}px`;
    dot.style.top = `${scanner.y || 20}px`;
    dot.dataset.id = scanner.id;
    enableScannerDrag(dot, scanner);
    map.appendChild(dot);
  });
}

/**
 * Enables drag behavior for a scanner dot.
 * @ai-generated
 * @param {HTMLElement} el - Scanner DOM element.
 * @param {Object} scanner - Scanner data model to update while dragging.
 * @returns {void}
 */
function enableScannerDrag(el, scanner) {
  let dragging = false;
  el.addEventListener('mousedown', event => {
    dragging = true;
    event.stopPropagation();
  });
  document.addEventListener('mousemove', event => {
    if (!dragging) return;
    const rect = document.getElementById('mapCanvas').getBoundingClientRect();
    scanner.x = event.clientX - rect.left;
    scanner.y = event.clientY - rect.top;
    el.style.left = `${scanner.x}px`;
    el.style.top = `${scanner.y}px`;
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
  });
}

/**
 * Saves the current map layout to the backend.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function saveMap() {
  const token = localStorage.getItem('auth_token');
  try {
    const res = await fetch('/api/map-layout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(mapData)
    });
    if (!res.ok) throw new Error(await res.text());
    alert('Map saved');
  } catch (err) {
    console.error('Save failed:', err);
    alert('Failed to save map');
  }
}

/**
 * Loads the saved map layout from the backend.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function loadMap() {
  const token = localStorage.getItem('auth_token');
  const canvas = document.getElementById('mapCanvas');
  canvas.innerHTML = '';
  canvas.style.cssText = 'width:100%;height:900px;background:linear-gradient(180deg, rgba(235,245,255,0.92), rgba(188,220,255,0.82));border-radius:18px;position:relative;overflow:hidden;';
  try {
    const res = await fetch('/api/map-layout', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    mapData.rooms = data.rooms || [];
    mapData.scanners = data.scanners || [];
    mapData.rooms.forEach(room => renderRoom(room));
    renderScanners();
  } catch (err) {
    console.error('Failed to load map:', err);
  }
}

/**
 * Loads supporting context such as logs, courses, and calendar data for map rendering.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function loadMapContext() {
  const token = localStorage.getItem('auth_token');
  try {
    const [logsRes, coursesRes, calendarRes] = await Promise.all([
      fetch('/api/logs', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/courses', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/calendar/today', { headers: { Authorization: `Bearer ${token}` } })
    ]);
    mapContext.logs = logsRes.ok ? await logsRes.json() : [];
    mapContext.courses = coursesRes.ok ? await coursesRes.json() : [];
    mapContext.calendar = calendarRes.ok ? await calendarRes.json() : null;
  } catch (error) {
    console.error('Failed to load map context:', error);
  }
}

/**
 * Refreshes the HTML for a room card after room data changes.
 * @ai-generated
 * @param {Object} room - Room data object.
 * @returns {void}
 */
function refreshRoomCard(room) {
  const roomEl = document.querySelector(`.room[data-id="${room.id}"]`);
  if (roomEl) {
    roomEl.innerHTML = roomMarkup(room);
  }
}

/**
 * Renders the selectable room list sidebar.
 * @ai-generated
 * @returns {void}
 */
function renderRoomList() {
  const container = document.getElementById('mapRoomList');
  if (!mapData.rooms.length) {
    container.innerHTML = '<div class="empty-state" style="padding: 1rem;">No rooms have been added yet.</div>';
    return;
  }

  const sortedRooms = [...mapData.rooms].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  container.innerHTML = sortedRooms.map(room => `
    <button class="map-room-button ${selectedRoomId === room.id ? 'active' : ''}" data-room-id="${room.id}">
      <strong>${escapeHtml(room.name)}</strong>
      <div class="muted">Layer ${room.z} | ${getCurrentRoomStudents(room.name).length} current | ${getTodayRoomStudents(room.name).length} today</div>
    </button>
  `).join('');

  container.querySelectorAll('.map-room-button').forEach(button => {
    button.addEventListener('click', () => {
      selectedRoomId = button.dataset.roomId;
      renderRoomList();
      renderSelectedRoom();
    });
  });
}

/**
 * Renders detail information for the currently selected room.
 * @ai-generated
 * @returns {void}
 */
function renderSelectedRoom() {
  const container = document.getElementById('selectedRoomDetails');
  const room = mapData.rooms.find(entry => entry.id === selectedRoomId);
  if (!room) {
    container.innerHTML = '<div class="empty-state" style="padding: 1rem;">Select a room to inspect its activity.</div>';
    return;
  }

  const courses = mapContext.courses.filter(course => String(course.room) === String(room.name));
  const studentsToday = getTodayRoomStudents(room.name);
  const studentsCurrent = getCurrentRoomStudents(room.name);
  const recentLogs = mapContext.logs.filter(log => String(log.scanner_location) === String(room.name)).slice(0, 4);

  container.innerHTML = `
    <div class="activity-item">
      <strong>${escapeHtml(room.name)}</strong>
      <div class="muted">Layer ${room.z} | ${courses.length ? courses.map(course => course.period).join(', ') : 'No configured periods'}</div>
    </div>
    <div class="activity-item">
      <strong>${studentsCurrent.length}</strong>
      <div class="muted">Students currently in class</div>
    </div>
    <div class="activity-item">
      <strong>${studentsToday.length}</strong>
      <div class="muted">Unique students recorded in this room today</div>
    </div>
    ${recentLogs.length ? recentLogs.map(log => `
      <div class="activity-item">
        <strong>${escapeHtml(log.first_name || 'Unknown')} ${escapeHtml(log.last_name || '')}</strong>
        <div class="muted">${escapeHtml(log.period || 'Unassigned')} | ${escapeHtml(log.date_scanned || '')} ${escapeHtml(log.time_scanned || '')}</div>
      </div>
    `).join('') : '<div class="empty-state" style="padding: 1rem;">No recent attendance activity for this room.</div>'}
  `;
}

/**
 * Renders map dashboard metrics such as rooms, scanners, and attendance counts.
 * @ai-generated
 * @returns {void}
 */
function renderMapMetrics() {
  const currentPeriod = getCurrentPeriodTitle();
  const currentAttendanceRooms = new Set(
    mapContext.logs
      .filter(log =>
        log.date_scanned === getTodayDate() &&
        currentPeriod &&
        String(log.period || '') === String(currentPeriod)
      )
      .map(log => String(log.scanner_location))
  );
  const currentStudents = new Set(
    mapContext.logs
      .filter(log =>
        log.date_scanned === getTodayDate() &&
        currentPeriod &&
        String(log.period || '') === String(currentPeriod)
      )
      .map(log => log.student_id)
      .filter(Boolean)
  );
  const todayRooms = new Set(
    mapContext.logs
      .filter(log => log.date_scanned === getTodayDate())
      .map(log => String(log.scanner_location))
  );

  const metrics = [
    { label: 'Rooms', value: mapData.rooms.length, footnote: 'Saved on the current layout' },
    { label: 'Scanners', value: mapData.scanners.length, footnote: 'Placed on the layout' },
    { label: 'Current Students', value: currentStudents.size, footnote: currentPeriod ? `${currentPeriod} attendance now` : 'No active class period right now' },
    { label: 'Active Today', value: todayRooms.size, footnote: currentPeriod ? `${currentAttendanceRooms.size} rooms active this period` : 'Rooms with attendance scans today' },
    { label: 'Layer', value: getCurrentLayer(), footnote: 'Currently visible floor or zone' }
  ];

  document.getElementById('mapMetrics').innerHTML = metrics.map(metric => `
    <div class="metric-card glass-panel">
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <span class="metric-value">${escapeHtml(String(metric.value))}</span>
      <span class="metric-footnote">${escapeHtml(metric.footnote)}</span>
    </div>
  `).join('');
}

/**
 * Returns the set of students seen today in the given room.
 * @ai-generated
 * @param {string} roomName - Room name to query.
 * @returns {Array<string>}
 */
function getTodayRoomStudents(roomName) {
  const today = getTodayDate();
  return [...new Set(
    mapContext.logs
      .filter(log => log.date_scanned === today && String(log.scanner_location) === String(roomName))
      .map(log => log.student_id)
      .filter(Boolean)
  )];
}

/**
 * Returns the set of students currently associated with the given room for the active period.
 * @ai-generated
 * @param {string} roomName - Room name to query.
 * @returns {Array<string>}
 */
function getCurrentRoomStudents(roomName) {
  const currentPeriod = getCurrentPeriodTitle();
  if (!currentPeriod) return [];
  const today = getTodayDate();
  return [...new Set(
    mapContext.logs
      .filter(log =>
        log.date_scanned === today &&
        String(log.scanner_location) === String(roomName) &&
        String(log.period || '') === String(currentPeriod)
      )
      .map(log => log.student_id)
      .filter(Boolean)
  )];
}

/**
 * Returns the current period title if a calendar event is active.
 * @ai-generated
 * @returns {string|null}
 */
function getCurrentPeriodTitle() {
  const events = mapContext.calendar?.events || [];
  if (!events.length) return null;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const active = events.find(event => {
    const startMinutes = timeToMinutes(event.startTime);
    const endMinutes = timeToMinutes(event.endTime);
    return startMinutes !== null && endMinutes !== null && currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  });
  return active?.title || null;
}

/**
 * Converts a time string into minutes past midnight.
 * @ai-generated
 * @param {string} value - Time value in HH:MM format.
 * @returns {number|null}
 */
function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Normalizes room attendance status labels.
 * @ai-generated
 * @param {string|undefined|null} status - Raw status value.
 * @returns {string}
 */
function normalizeStatus(status) {
  const value = String(status || 'Unknown').trim().toLowerCase();
  if (value === 'on-time' || value === 'on time' || value === 'ontime') return 'On Time';
  if (value === 'late') return 'Late';
  if (value === 'absent') return 'Absent';
  if (value === 'excused') return 'Excused';
  return 'Unknown';
}

/**
 * Returns today's date string in local YYYY-MM-DD format.
 * @ai-generated
 * @returns {string}
 */
function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().split('T')[0];
}

/**
 * Escapes values for safe HTML rendering.
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
