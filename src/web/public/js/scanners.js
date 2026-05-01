/**
 * public/js/scanners.js
 * Manages connected scanner state, terminal command queues, and scanner UI interactions.
 * @ai-generated
 */
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

const COMMANDS = [
  "set mode scanner",
  "set mode enroll",
  "slots show",
  "slots reset",
  "reset",
  "wifi info",
  "restart",
  "reauth",
  "test scan",
  "get student",
  "delete student",
];

let terminalSocket = null;

/**
 * Initializes the scanners page by binding UI actions and loading scanner data.
 * @ai-generated
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', initScannersPage);

function initScannersPage() {
  bindScannerUi();
  loadScanners();
}

/**
 * Attaches event listeners for scanner management controls and terminal interactions.
 * @ai-generated
 * @returns {void}
 */
function bindScannerUi() {
  document.getElementById('uploadScannersBtn').addEventListener('click', () => {
    document.getElementById('scannerCsvInput').click();
  });
  document.getElementById('downloadScannersTemplateBtn').addEventListener('click', downloadScannersTemplate);
  document.getElementById('scannerCsvInput').addEventListener('change', handleScannersCsvUpload);
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
  document.getElementById('terminalInput').addEventListener('input', function () {
    const value = this.value.toLowerCase();

    const suggestion = COMMANDS.find(cmd => cmd.startsWith(value));

    if (suggestion && value.length > 1) {
      this.setAttribute("data-suggestion", suggestion);
    } else {
      this.removeAttribute("data-suggestion");
    }
  });
  document.getElementById('scannerModeBtn').addEventListener('click', () => sendTerminalCommand('set mode scanner'));
  document.getElementById('enrollModeBtn').addEventListener('click', () => sendTerminalCommand('set mode enroll'));
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

/**
 * Loads the scanner inventory from the server and refreshes UI components.
 * @ai-generated
 * @returns {Promise<void>}
 */
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

/**
 * Renders scanner fleet metrics based on loaded scanner state.
 * @ai-generated
 * @returns {void}
 */
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

/**
 * Builds the scanner management table from the current scanner state.
 * @ai-generated
 * @returns {void}
 */
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

/**
 * Opens the modal to create a new scanner.
 * @ai-generated
 * @returns {void}
 */
function openCreateScannerModal() {
  scannerState.editingId = null;
  document.getElementById('scannerForm').reset();
  document.getElementById('scannerModalTitle').textContent = 'Add Scanner';
  document.getElementById('scannerSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Create Scanner';
  document.getElementById('scannerMessage').textContent = '';
  document.getElementById('scanner_password').required = true;
  document.getElementById('scannerModal').style.display = 'flex';
}

/**
 * Opens the scanner edit modal and populates form fields.
 * @ai-generated
 * @param {Object} scanner - Scanner object to edit.
 * @returns {void}
 */
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

/**
 * Closes the scanner create/edit modal.
 * @ai-generated
 * @returns {void}
 */
function closeScannerModal() {
  document.getElementById('scannerModal').style.display = 'none';
}

/**
 * Submits the scanner form to create or update a scanner.
 * @ai-generated
 * @param {Event} event - The form submit event.
 * @returns {Promise<void>}
 */
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

/**
 * Deletes the selected scanner from the backend.
 * @ai-generated
 * @param {Object} scanner - Scanner object to remove.
 * @returns {Promise<void>}
 */
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

/**
 * Handles bulk scanner CSV upload and sends scanner records to the backend.
 * @ai-generated
 * @param {Event} event - File change event from CSV input.
 * @returns {Promise<void>}
 */
async function handleScannersCsvUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const rows = parseCsv(await file.text());
    const scanners = rows.map(row => ({
      scanner_id: pickCsvValue(row, ['scanner_id', 'scannerid', 'id']),
      scanner_location: pickCsvValue(row, ['scanner_location', 'location', 'room']),
      password: pickCsvValue(row, ['password', 'scanner_password', 'scannerpassword'])
    })).filter(scanner => Object.values(scanner).some(Boolean));

    if (!scanners.length) {
      throw new Error('No valid scanner rows were found in the CSV');
    }

    const response = await fetchWithToken('/api/scanners/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanners })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to upload scanners');
    }

    alert(`Uploaded ${data.inserted || scanners.length} scanners successfully.`);
    await loadScanners();
  } catch (error) {
    console.error('Failed to upload scanners:', error);
    alert(error.message || 'Failed to upload scanners');
  } finally {
    event.target.value = '';
  }
}

/**
 * Opens the terminal UI for a selected scanner.
 * @ai-generated
 * @param {Object} scanner - Scanner to open terminal for.
 * @returns {Promise<void>}
 */
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
  connectTerminalWebSocket();
  await refreshTerminalStatus(true);
  //startTerminalPolling();
  document.getElementById('terminalInput').focus();
}

/**
 * Connects to the backend WebSocket for live scanner terminal updates.
 * @ai-generated
 * @returns {void}
 */
function connectTerminalWebSocket() {
  if (terminalSocket) {
    terminalSocket.close();
  }
const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
terminalSocket = new WebSocket(`${wsProtocol}${window.location.host}/ws`);
  terminalSocket.onopen = () => {
    console.log("Frontend WS connected");
    terminalSocket.send(JSON.stringify({
      type: "frontend",
      scannerId: terminalState.scannerId
    }));
  };
  terminalSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (String(data.scannerId) !== String(terminalState.scannerId)) return;
    if (data.type === "output") {
      appendTerminalLine(data.output, 'output');
      terminalState.awaitingResponse = false;
      updateTerminalModeUi();
    }
  };
  terminalSocket.onclose = (event) => {
    console.log("Frontend WS closed", event.code, event.reason);
  };
}

/**
 * Closes the scanner terminal modal and cleans up any polling/socket resources.
 * @ai-generated
 * @returns {void}
 */
function closeTerminal() {
  document.getElementById('terminalModal').style.display = 'none';
  if (terminalState.poller) {
    clearInterval(terminalState.poller);
  }
  if (terminalSocket) {
    terminalSocket.close();
    terminalSocket = null;
  }
  terminalState.poller = null;
  terminalState.scannerId = null;
}

/**
 * Starts polling scanner terminal status at a fixed interval.
 * @ai-generated
 * @returns {void}
 */
function startTerminalPolling() {
  if (terminalState.poller) {
    clearInterval(terminalState.poller);
  }
  terminalState.poller = setInterval(() => {
    if (!terminalState.scannerId) return;
    refreshTerminalStatus();
  }, 1500);
}

/**
 * Refreshes the current terminal session state and appends received output.
 * @ai-generated
 * @param {boolean} [forceIntro=false] - If true, writes an introductory status line.
 * @returns {Promise<void>}
 */
async function refreshTerminalStatus(forceIntro = false) {
  if (!terminalState.scannerId) return;

  try {
    // Only poll the output endpoint — never the scanner-poll GET /terminal.
    // That GET is for the physical device to pick up commands; its mode field
    // reflects the server session default and would clobber the real enroll state.
    const outputResponse = await fetchWithToken(
      `/api/scanners/${terminalState.scannerId}/terminal/output?afterVersion=${terminalState.outputVersion}`
    );
    const outputData = await outputResponse.json();

    // Only overwrite mode when the scanner has actually reported one
    if (outputData.mode) {
      terminalState.mode = outputData.mode;
    }
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

/**
 * Submits user-entered terminal input to the scanner session.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function submitTerminalInput() {
  const input = document.getElementById('terminalInput');
  const command = input.value.trim();
  if (!command) return;
  await sendTerminalCommand(command);
  input.value = '';
  input.focus();
}

/**
 * Sends a command to the active scanner terminal session.
 * @ai-generated
 * @param {string} command - Terminal command string.
 * @returns {Promise<void>}
 */
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
      appendTerminalLine(`Error: ${data.error || 'Failed to send command'}`, 'error');
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

/**
 * Updates the terminal UI labels and placeholder text based on current mode.
 * @ai-generated
 * @returns {void}
 */
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

/**
 * Updates the heartbeat indicator for the scanner terminal session.
 * @ai-generated
 * @param {string|null} scannerLastSeenAt - Last seen timestamp reported by scanner.
 * @param {boolean} [isError=false] - Whether the heartbeat is in an error state.
 * @returns {void}
 */
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

/**
 * Appends a line of terminal output to the terminal stream.
 * @ai-generated
 * @param {string} text - Text to append.
 * @param {string} type - CSS class for line type (e.g. output, command, error).
 * @returns {void}
 */
function appendTerminalLine(text, type) {
  const stream = document.getElementById('terminalLines');
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  stream.appendChild(line);
  stream.scrollTop = stream.scrollHeight;
}

/**
 * Normalizes scanner status values into a readable label.
 * @ai-generated
 * @param {string|undefined|null} status - Raw scanner status.
 * @returns {string}
 */
function normalizeScannerStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'online') return 'Online';
  if (value === 'offline') return 'Offline';
  if (!value) return 'Unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Maps scanner status labels to CSS class names for table display.
 * @ai-generated
 * @param {string|undefined|null} status - Raw scanner status.
 * @returns {string}
 */
function statusClass(status) {
  const value = normalizeScannerStatus(status).toLowerCase();
  if (value === 'online') return 'on-time';
  if (value === 'offline') return 'absent';
  return 'unknown';
}

/**
 * Formats a timestamp into a readable date/time string.
 * @ai-generated
 * @param {string|number} value - Timestamp or date string.
 * @returns {string}
 */
function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Converts a timestamp into a human relative time string.
 * @ai-generated
 * @param {string|number|Date} value - Timestamp or date value.
 * @returns {string}
 */
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

/**
 * Formats a battery voltage or level value for display.
 * @ai-generated
 * @param {number|string|null|undefined} value - Battery reading.
 * @returns {string}
 */
function formatBattery(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  // If value > 10, treat as percentage? Or just show volts.
  // For voltage: show "3.7 V"
  const Value = value + 'V';
  value = voltageToPercent(Number(value)) + '%';
  return `${value} | ${Value}`;
}

/**
 * Converts voltage to a battery percentage between 0 and 100.
 * @ai-generated
 * @param {number} voltage - Voltage reading.
 * @returns {number}
 */
function voltageToPercent(voltage) {
  const min = 3.0, max = 4.2;
  let percent = (voltage - min) / (max - min) * 100;
  percent = Math.min(100, Math.max(0, percent));
  return Math.round(percent);
}

/**
 * Returns HTML markup for scanner metric cards.
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
 * Sends a fetch request with the stored authorization token.
 * @ai-generated
 * @param {string} url - Endpoint URL.
 * @param {RequestInit} [options={}] - Fetch options.
 * @returns {Promise<Response>}
 */
function fetchWithToken(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

/**
 * Fetches JSON from the given endpoint and throws on failure.
 * @ai-generated
 * @param {string} url - Endpoint URL.
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  const response = await fetchWithToken(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }
  return response.json();
}

/**
 * Escapes a value for safe HTML output.
 * @ai-generated
 * @param {string|number} value - Value to escape.
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

/**
 * Parses CSV text into an array of row objects using normalized headers.
 * @ai-generated
 * @param {string} text - Raw CSV content.
 * @returns {Array<Object>}
 */
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

/**
 * Normalizes a CSV header cell into a safe lowercase key.
 * @ai-generated
 * @param {string} value - Header label.
 * @returns {string}
 */
function normalizeCsvHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Picks the first matching value from a CSV row using a set of candidate keys.
 * @ai-generated
 * @param {Object} row - Parsed CSV row.
 * @param {Array<string>} keys - Possible header names.
 * @returns {string}
 */
function pickCsvValue(row, keys) {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return '';
}

/**
 * Downloads a sample CSV template for scanner bulk upload.
 * @ai-generated
 * @returns {void}
 */
function downloadScannersTemplate() {
  downloadCsvRows([
    ['scanner_id', 'scanner_location', 'password'],
    ['SCN-01', 'Room 101', 'ScannerPass123']
  ], 'scanners_template.csv');
}

/**
 * Downloads the supplied rows as a CSV file.
 * @ai-generated
 * @param {Array<Array<string>>} rows - CSV rows.
 * @param {string} fileName - File name to save.
 * @returns {void}
 */
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

/**
 * Escapes a value for CSV output.
 * @ai-generated
 * @param {string|number|null|undefined} value - Raw cell value.
 * @returns {string}
 */
function escapeCsvValue(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  if (!/[",\n\r]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}
