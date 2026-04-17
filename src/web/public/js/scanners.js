const scannerState = {
  scanners: [],
  editingId: null
};

const terminalState = {
  scannerId: null,
  scannerLabel: '',
  mode: 'scanner',
  outputVersion: 0,
  poller: null,
  awaitingResponse: false
};

document.addEventListener('DOMContentLoaded', initScannersPage);

function initScannersPage() {
  bindScannerUi();
  loadScanners();
}

function bindScannerUi() {
  document.getElementById('openScannerModal').addEventListener('click', openCreateScannerModal);
  document.getElementById('closeScannerModal').addEventListener('click', closeScannerModal);
  document.getElementById('scannerForm').addEventListener('submit', submitScannerForm);
  document.getElementById('closeTerminalModal').addEventListener('click', closeTerminal);
  document.getElementById('sendTerminalBtn').addEventListener('click', submitTerminalInput);
  document.getElementById('terminalInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitTerminalInput();
    }
  });
  document.getElementById('scannerModeBtn').addEventListener('click', () => sendTerminalCommand('scanner'));
  document.getElementById('enrollModeBtn').addEventListener('click', () => sendTerminalCommand('enroll'));
  document.getElementById('refreshTerminalBtn').addEventListener('click', refreshTerminalStatus);

  window.addEventListener('click', event => {
    if (event.target === document.getElementById('scannerModal')) {
      closeScannerModal();
    }
    if (event.target === document.getElementById('terminalModal')) {
      closeTerminal();
    }
  });
}

async function loadScanners() {
  const container = document.getElementById('scannersListContainer');
  container.innerHTML = '<div class="loading-state-panel">Loading scanners...</div>';

  try {
    scannerState.scanners = await fetchJson('/api/scanners');
    renderScannerMetrics();
    renderScannersTable();
  } catch (error) {
    console.error('Failed to load scanners:', error);
    container.innerHTML = '<div class="empty-state">Unable to load connected scanners right now.</div>';
  }
}

function renderScannerMetrics() {
  const scanners = scannerState.scanners;
  const online = scanners.filter(scanner => String(scanner.scanner_status || '').toLowerCase() === 'online').length;
  const offline = scanners.length - online;
  const withBattery = scanners.filter(scanner => scanner.battery_level !== null && scanner.battery_level !== undefined && scanner.battery_level !== '').length;

  const metrics = [
    { label: 'Total Scanners', value: scanners.length, footnote: 'Registered scanner devices' },
    { label: 'Online', value: online, footnote: 'Reporting as online' },
    { label: 'Offline', value: offline, footnote: 'Need a connection check' },
    { label: 'Battery Reports', value: withBattery, footnote: 'Scanners sending battery data' }
  ];

  document.getElementById('scannerMetrics').innerHTML = metrics.map(metricCardMarkup).join('');
  document.getElementById('scannerFleetPill').textContent = scanners.length ? `${scanners.length} scanners tracked` : 'No scanners yet';
}

function renderScannersTable() {
  const container = document.getElementById('scannersListContainer');
  if (!scannerState.scanners.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No Scanners Connected</h3>
        <p>Add a scanner to start managing device health and terminal sessions.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="management-table-shell">
      <table class="management-table">
        <thead>
          <tr>
            <th>Scanner ID</th>
            <th>Location</th>
            <th>Status</th>
            <th>Last Sync</th>
            <th>Battery</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${scannerState.scanners.map(scanner => `
            <tr>
              <td>${escapeHtml(scanner.scanner_id)}</td>
              <td>${escapeHtml(scanner.scanner_location)}</td>
              <td><span class="status-pill ${statusClass(scanner.scanner_status)}">${escapeHtml(normalizeScannerStatus(scanner.scanner_status))}</span></td>
              <td>${escapeHtml(formatDateTime(scanner.last_sync))}</td>
              <td>${escapeHtml(formatBattery(scanner.battery_level))}</td>
              <td>
                <div class="management-action-row">
                  <button type="button" class="soft-button" data-action="edit" data-id="${scanner.id}">Edit</button>
                  <button type="button" class="accent-button" data-action="terminal" data-id="${scanner.id}">Terminal</button>
                  <button type="button" class="danger-button" data-action="delete" data-id="${scanner.id}">Delete</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      const scanner = scannerState.scanners.find(entry => String(entry.id) === String(button.dataset.id));
      if (!scanner) return;

      if (button.dataset.action === 'edit') {
        openEditScannerModal(scanner);
      }
      if (button.dataset.action === 'terminal') {
        openTerminal(scanner);
      }
      if (button.dataset.action === 'delete') {
        deleteScanner(scanner);
      }
    });
  });
}

function openCreateScannerModal() {
  scannerState.editingId = null;
  document.getElementById('scannerForm').reset();
  document.getElementById('scannerModalTitle').textContent = 'Add Scanner';
  document.getElementById('scannerSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Create Scanner';
  document.getElementById('scannerMessage').textContent = '';
  document.getElementById('scanner_password').required = true;
  document.getElementById('scannerModal').style.display = 'flex';
}

function openEditScannerModal(scanner) {
  scannerState.editingId = scanner.id;
  document.getElementById('scanner_id').value = scanner.scanner_id || '';
  document.getElementById('scanner_location').value = scanner.scanner_location || '';
  document.getElementById('scanner_password').value = '';
  document.getElementById('scanner_password').required = false;
  document.getElementById('scannerModalTitle').textContent = 'Edit Scanner';
  document.getElementById('scannerSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Update Scanner';
  document.getElementById('scannerMessage').textContent = '';
  document.getElementById('scannerModal').style.display = 'flex';
}

function closeScannerModal() {
  document.getElementById('scannerModal').style.display = 'none';
}

async function submitScannerForm(event) {
  event.preventDefault();
  const messageEl = document.getElementById('scannerMessage');
  const payload = {
    scanner_id: document.getElementById('scanner_id').value.trim(),
    scanner_location: document.getElementById('scanner_location').value.trim(),
    scanner_password: document.getElementById('scanner_password').value
  };

  messageEl.textContent = scannerState.editingId ? 'Updating scanner...' : 'Creating scanner...';

  try {
    let response;
    if (scannerState.editingId) {
      const body = {
        scanner_id: payload.scanner_id,
        scanner_location: payload.scanner_location
      };
      if (payload.scanner_password) {
        body.scanner_password = payload.scanner_password;
      }
      response = await fetchWithToken(`/api/scanners/${scannerState.editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      response = await fetchWithToken('/api/scanners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SCANNER_ID: payload.scanner_id,
          SCANNER_LOCATION: payload.scanner_location,
          SCANNER_PASSWORD: payload.scanner_password
        })
      });
    }

    const data = await response.json();
    if (!response.ok) {
      messageEl.textContent = data.error || 'Unable to save scanner.';
      return;
    }

    messageEl.textContent = scannerState.editingId ? 'Scanner updated successfully.' : 'Scanner created successfully.';
    await loadScanners();
    setTimeout(closeScannerModal, 400);
  } catch (error) {
    console.error('Failed to save scanner:', error);
    messageEl.textContent = 'Server error while saving scanner.';
  }
}

async function deleteScanner(scanner) {
  if (!confirm(`Delete scanner "${scanner.scanner_id}"?`)) {
    return;
  }

  try {
    const response = await fetchWithToken(`/api/scanners/${scanner.id}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error('Delete failed');
    }
    loadScanners();
  } catch (error) {
    console.error('Failed to delete scanner:', error);
    alert('Unable to delete scanner right now.');
  }
}

async function openTerminal(scanner) {
  terminalState.scannerId = scanner.id;
  terminalState.scannerLabel = `${scanner.scanner_id} | ${scanner.scanner_location}`;
  terminalState.outputVersion = 0;
  terminalState.awaitingResponse = false;
  document.getElementById('terminalLines').innerHTML = '';
  document.getElementById('terminalInput').value = '';
  document.getElementById('terminalTitle').textContent = `Scanner Terminal`;
  document.getElementById('terminalSubtitle').textContent = terminalState.scannerLabel;
  document.getElementById('terminalModal').style.display = 'flex';
  appendTerminalLine('Connected to scanner terminal session.', 'system');
  await refreshTerminalStatus(true);
  startTerminalPolling();
  document.getElementById('terminalInput').focus();
}

function closeTerminal() {
  document.getElementById('terminalModal').style.display = 'none';
  if (terminalState.poller) {
    clearInterval(terminalState.poller);
  }
  terminalState.poller = null;
  terminalState.scannerId = null;
}

function startTerminalPolling() {
  if (terminalState.poller) {
    clearInterval(terminalState.poller);
  }
  terminalState.poller = setInterval(() => {
    if (!terminalState.scannerId) return;
    refreshTerminalStatus();
  }, 1500);
}

async function refreshTerminalStatus(forceIntro = false) {
  if (!terminalState.scannerId) return;

  try {
    const [modeResponse, outputResponse] = await Promise.all([
      fetchWithToken(`/api/scanners/${terminalState.scannerId}/terminal`),
      fetchWithToken(`/api/scanners/${terminalState.scannerId}/terminal/output?afterVersion=${terminalState.outputVersion}`)
    ]);

    const modeData = await modeResponse.json();
    const outputData = await outputResponse.json();
    terminalState.mode = outputData.mode || modeData.mode || terminalState.mode;
    terminalState.outputVersion = Number(outputData.outputVersion || terminalState.outputVersion || 0);

    updateTerminalModeUi();
    updateHeartbeat(outputData.scannerLastSeenAt);

    if (forceIntro) {
      appendTerminalLine(`Current mode: ${terminalState.mode}`, 'system');
    }

    (outputData.entries || []).forEach(entry => {
      appendTerminalLine(entry.output, 'output');
      terminalState.awaitingResponse = false;
    });
  } catch (error) {
    console.error('Failed to refresh terminal status:', error);
    updateHeartbeat(null, true);
  }
}

async function submitTerminalInput() {
  const input = document.getElementById('terminalInput');
  const command = input.value.trim();
  if (!command) return;
  await sendTerminalCommand(command);
  input.value = '';
  input.focus();
}

async function sendTerminalCommand(command) {
  if (!terminalState.scannerId) return;

  appendTerminalLine(`> ${command}`, 'command');

  try {
    const response = await fetchWithToken(`/api/scanners/${terminalState.scannerId}/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    const data = await response.json();
    if (!response.ok) {
      appendTerminalLine(data.error || 'Unable to send command.', 'error');
      return;
    }

    terminalState.mode = data.mode || terminalState.mode;
    terminalState.awaitingResponse = true;
    updateTerminalModeUi();
    appendTerminalLine('Command queued for scanner response...', 'system');
  } catch (error) {
    console.error('Failed to send terminal command:', error);
    appendTerminalLine('Server error while sending command.', 'error');
  }
}

function updateTerminalModeUi() {
  const modeEl = document.getElementById('modeIndicator');
  const hintEl = document.getElementById('terminalHint');
  const input = document.getElementById('terminalInput');

  modeEl.className = `mode-chip ${terminalState.mode === 'enroll' ? 'enroll' : 'scanner'}`;
  modeEl.innerHTML = terminalState.mode === 'enroll'
    ? '<i class="fas fa-user-plus"></i> Enroll Mode'
    : '<i class="fas fa-qrcode"></i> Scanner Mode';

  if (terminalState.mode === 'enroll') {
    hintEl.textContent = terminalState.awaitingResponse
      ? 'Waiting for the scanner to answer. You can keep typing enrollment input when the device is ready.'
      : 'Enroll mode is active. Type the student ID, badge value, or enrollment input you want sent to the scanner.';
    input.placeholder = 'Enter enrollment input';
    return;
  }

  hintEl.textContent = terminalState.awaitingResponse
    ? 'Waiting for the scanner to answer the last command.'
    : 'Scanner mode accepts standard commands. Switch to enroll mode when you need to type enrollment input directly.';
  input.placeholder = 'Enter scanner command';
}

function updateHeartbeat(scannerLastSeenAt, isError = false) {
  const pill = document.getElementById('scannerHeartbeatPill');
  if (isError) {
    pill.textContent = 'Unable to reach scanner session';
    return;
  }
  if (!scannerLastSeenAt) {
    pill.textContent = 'Waiting for scanner';
    return;
  }
  pill.textContent = `Scanner seen ${formatRelativeTime(scannerLastSeenAt)}`;
}

function appendTerminalLine(text, type) {
  const stream = document.getElementById('terminalLines');
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  stream.appendChild(line);
  stream.scrollTop = stream.scrollHeight;
}

function normalizeScannerStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'online') return 'Online';
  if (value === 'offline') return 'Offline';
  if (!value) return 'Unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusClass(status) {
  const value = normalizeScannerStatus(status).toLowerCase();
  if (value === 'online') return 'on-time';
  if (value === 'offline') return 'absent';
  return 'unknown';
}

function formatBattery(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  return String(value).includes('%') ? String(value) : `${value}%`;
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(Math.round(diffMs / 1000), 0);
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
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

function fetchWithToken(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

async function fetchJson(url) {
  const response = await fetchWithToken(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
