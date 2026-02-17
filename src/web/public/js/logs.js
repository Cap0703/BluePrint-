let allLogs = [];

async function fetch_logs() {
    try {
        const res = await fetch('/api/logs');
        allLogs = await res.json();
        renderLogs();
    } catch (err) {
        console.error("Failed to fetch logs:", err);
    }
}

function getStatusText(status) {
    switch (status) {
        case '1': return 'On Time';
        case '2': return 'Late';
        case '3': return 'Absent';
        case '4': return 'Excused';
        default: return 'Unknown';
    }
}

function getStatusClass(status) {
    switch (status) {
        case '1': return 'on-time';
        case '2': return 'late';
        case '3': return 'absent';
        case '4': return 'excused';
        default: return '';
    }
}


function renderLogs() {
    const container = document.getElementById('logsContent');
    container.innerHTML = '';

    if (allLogs.length === 0) {
        container.innerHTML = "<p>No logs found.</p>";
        return;
    }
    const table = document.createElement('table');
    table.classList.add('logs-table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Time</th>
                <th>First</th>
                <th>Last</th>
                <th>Student ID</th>
                <th>Period</th>
                <th>Location</th>
                <th>Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    allLogs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-date">${log.date_scanned}</td>
            <td class="col-time">${log.time_scanned}</td>
            <td class="col-first">${log.first_name}</td>
            <td class="col-last">${log.last_name}</td>
            <td class="col-id">${log.student_id}</td>
            <td class="col-period">${log.period}</td>
            <td class="col-location">${log.scanner_location}</td>
            <td class="${getStatusClass(log.status)}">
                ${getStatusText(log.status)}
            </td>
            <td>
                <button class="delete-btn" onclick="deleteLog(${log.id})">
                    Delete
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    container.appendChild(table);
}


async function addLog() {
    try {
        await fetch('/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newLog)
        });
        fetch_logs();
    } catch (err) {
        console.error("Failed to add log:", err);
    }
}

async function deleteLog(id) {
    if (!confirm("Delete this log entry?")) return;
    try {
        await fetch(`/api/logs/${id}`, {
            method: 'DELETE'
        });
        fetch_logs();
    } catch (err) {
        console.error("Failed to delete log:", err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetch_logs();
    const modal = document.getElementById('logModal');
    const openBtn = document.getElementById('addLogButton');
    const closeBtn = document.getElementById('closeModal');
    const form = document.getElementById('logForm');
    openBtn.onclick = () => modal.style.display = "block";
    closeBtn.onclick = () => modal.style.display = "none";
    window.onclick = (e) => {
        if (e.target === modal) modal.style.display = "none";
    };
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const logData = Object.fromEntries(formData.entries());
        logData.time_scanned = new Date().toLocaleTimeString();
        logData.date_scanned = new Date().toISOString().split('T')[0];
        try {
            await fetch('/api/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(logData)
            });
            modal.style.display = "none";
            form.reset();
            fetch_logs();
        } catch (err) {
            console.error("Failed to add log:", err);
        }
    });
});
