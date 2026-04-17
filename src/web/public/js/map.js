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

function bindMapControls() {
  document.getElementById('addRoomButton').addEventListener('click', () => {
    createRoom(document.getElementById('roomName').value, getCurrentLayer());
  });
  document.getElementById('saveMapButton').addEventListener('click', saveMap);
  document.getElementById('deleteModeBtn').addEventListener('click', toggleDeleteMode);
  document.getElementById('upLayerButton').addEventListener('click', upLayer);
  document.getElementById('downLayerButton').addEventListener('click', downLayer);
}

function reloadLevel() {
  const layerEl = document.getElementById('currentMapLayer');
  const z = parseInt(layerEl.dataset.z || '0', 10);
  layerEl.dataset.z = String(z);
  layerEl.textContent = String(z);
  updateLayerVisibility();
}

function upLayer() {
  const layerEl = document.getElementById('currentMapLayer');
  layerEl.dataset.z = String((parseInt(layerEl.dataset.z || '0', 10)) + 1);
  reloadLevel();
}

function downLayer() {
  const layerEl = document.getElementById('currentMapLayer');
  layerEl.dataset.z = String((parseInt(layerEl.dataset.z || '0', 10)) - 1);
  reloadLevel();
}

function getCurrentLayer() {
  return parseInt(document.getElementById('currentMapLayer').dataset.z || '0', 10);
}

function updateLayerVisibility() {
  const currentLayer = getCurrentLayer();
  document.querySelectorAll('.room').forEach(room => {
    const roomLayer = parseInt(room.dataset.layer, 10);
    room.style.opacity = roomLayer === currentLayer ? '1' : '0.18';
    room.style.pointerEvents = roomLayer === currentLayer ? 'auto' : 'none';
  });
}

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  document.getElementById('deleteModeBtn').textContent = deleteMode ? 'Exit Delete Mode' : 'Delete Mode';
}

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

function refreshRoomCard(room) {
  const roomEl = document.querySelector(`.room[data-id="${room.id}"]`);
  if (roomEl) {
    roomEl.innerHTML = roomMarkup(room);
  }
}

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

function getTodayRoomStudents(roomName) {
  const today = getTodayDate();
  return [...new Set(
    mapContext.logs
      .filter(log => log.date_scanned === today && String(log.scanner_location) === String(roomName))
      .map(log => log.student_id)
      .filter(Boolean)
  )];
}

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

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function normalizeStatus(status) {
  const value = String(status || 'Unknown').trim().toLowerCase();
  if (value === 'on-time' || value === 'on time' || value === 'ontime') return 'On Time';
  if (value === 'late') return 'Late';
  if (value === 'absent') return 'Absent';
  if (value === 'excused') return 'Excused';
  return 'Unknown';
}

function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().split('T')[0];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
