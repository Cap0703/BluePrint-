async function getPeriodsToday() {
    const calendarData = await getCalendarEvents();
    const events = calendarData.events || [];
    let periodsToday = [];
    events.forEach(event => {
        if (!(event.title.toLowerCase().includes('lunch') || 
              event.title.toLowerCase().includes('break') || 
              event.title.toLowerCase().includes('transition'))) {
            periodsToday.push(event);
        }
    });
    return periodsToday;
}

async function loadCalendarEvents() {
    const container = document.getElementById('eventsContainer');
    container.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <div>Loading schedule...</div>
        </div>
    `;
    try {
        const response = await fetch('/api/calendar/today');
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        displayEvents(data);
    } catch (error) {
        console.error(error);
        displayFallbackEvents();
    }
}

async function getCalendarEvents() {
    try {
        const response = await fetch('/api/calendar/today');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server returned non-JSON response');
        }
        const result = await response.json();
        if (result.error) {
            throw new Error(result.error);
        }
        return result;
    } catch (error) {
        console.error('Error fetching calendar events:', error);
        return {
            date: new Date().toISOString().split('T')[0],
            events: [
                {
                    title: "Period 1",
                    startTime: "08:00",
                    endTime: "09:25"
                },
                {
                    title: "Period 2", 
                    startTime: "09:30",
                    endTime: "10:50"
                },
                {
                    title: "Period 3",
                    startTime: "11:10", 
                    endTime: "12:30"
                },
                {
                    title: "Period 4",
                    startTime: "13:05",
                    endTime: "14:25"
                }
            ],
            lastUpdated: new Date().toISOString()
        };
    }
}

function displayEvents(calendarData) {
    const container = document.getElementById('eventsContainer');
    if (calendarData.lastUpdated) {
        updateCacheStatus(calendarData.lastUpdated);
    }
    const events = (calendarData.events || []).filter(event => {
        const t = event.title.toLowerCase();
        return !(t.includes('lunch') || t.includes('break') || t.includes('transition'));
    });
    if (!events.length) {
        container.innerHTML = '<div class="no-events">No schedule found for today</div>';
        return;
    }
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    let html = '';
    let currentPeriodFound = false;
    const TOP_OFFSET = 10;
    for (let hour = 0; hour < 24; hour++) {
        const topPosition = hour * 60 + TOP_OFFSET;
        html += `<div class="hour-marker" style="top: ${topPosition}px;"></div>`;
        const halfHourTop = topPosition + 30;
        html += `<div class="half-hour-marker" style="top: ${halfHourTop}px;"></div>`;
    }
    if (currentTotalMinutes >= 0 && currentTotalMinutes < 24 * 60) {
        const indicatorTop = currentTotalMinutes + TOP_OFFSET;
        const displayHour = currentHours === 0 ? 12 : (currentHours > 12 ? currentHours - 12 : currentHours);
        const ampm = currentHours >= 12 ? 'PM' : 'AM';
        html += `
            <div class="current-time-indicator" style="top: ${indicatorTop}px;"></div>
            <div class="current-time-label" style="top: ${indicatorTop - 15}px;">
                ${displayHour}:${currentMinutes.toString().padStart(2, '0')} ${ampm}
            </div>
        `;
    }
    events.forEach(event => {
        const startTime = event.startTime.split(':');
        const endTime = event.endTime.split(':');
        const startHours = parseInt(startTime[0]);
        const startMinutes = parseInt(startTime[1]);
        const endHours = parseInt(endTime[0]);
        const endMinutes = parseInt(endTime[1]);
        const startTotalMinutes = startHours * 60 + startMinutes;
        const endTotalMinutes = endHours * 60 + endMinutes;
        const top = startTotalMinutes + TOP_OFFSET;
        const height = endTotalMinutes - startTotalMinutes;
        const isCurrent = currentTotalMinutes >= startTotalMinutes && 
                          currentTotalMinutes <= endTotalMinutes;
        if (isCurrent) currentPeriodFound = true;
        const formatTime = (hours, minutes) => {
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
            return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        };
        html += `
            <div class="event-item ${isCurrent ? 'current-period' : ''}" 
                 style="top: ${top}px; height: ${height}px; left: 10px; right: 10px;">
                <div class="event-time">
                    ${formatTime(startHours, startMinutes)} – ${formatTime(endHours, endMinutes)}
                </div>
                <div class="event-title">${event.title}</div>
            </div>
        `;
    });
    if (!currentPeriodFound) {
        let message = '';
        if (currentTotalMinutes < 7 * 60) {
            message = 'School hasn\'t started yet';
        } else if (currentTotalMinutes > 17 * 60) {
            message = 'School day has ended';
        } else {
            message = 'Between periods';
        }
        const indicatorTop = Math.max(TOP_OFFSET, Math.min(1440, currentTotalMinutes + TOP_OFFSET));
        html += `
            <div class="event-item" style="top: ${indicatorTop}px; height: 50px; background: rgba(255, 82, 82, 0.1); border-left-color: #ff5252;">
                <div class="event-title" style="color: #ff8a80;">
                    ${message} • No current period
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

function displayFallbackEvents() {
    const fallbackEvents = [
        {
            title: "Period 1",
            startTime: "08:00",
            endTime: "09:25"
        },
        {
            title: "Period 2", 
            startTime: "09:30",
            endTime: "10:50"
        },
        {
            title: "Period 3",
            startTime: "11:10", 
            endTime: "12:30"
        },
        {
            title: "Period 4",
            startTime: "13:05",
            endTime: "14:25"
        }
    ];
    const container = document.getElementById('eventsContainer');
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    let html = '';
    let currentPeriodFound = false;
    const TOP_OFFSET = 10;
    for (let hour = 0; hour < 24; hour++) {
        const topPosition = hour * 60 + TOP_OFFSET;
        html += `<div class="hour-marker" style="top: ${topPosition}px;"></div>`;
        const halfHourTop = topPosition + 30;
        html += `<div class="half-hour-marker" style="top: ${halfHourTop}px;"></div>`;
    }
    if (currentTotalMinutes >= 0 && currentTotalMinutes < 24 * 60) {
        const indicatorTop = currentTotalMinutes + TOP_OFFSET;
        const displayHour = currentHours === 0 ? 12 : (currentHours > 12 ? currentHours - 12 : currentHours);
        const ampm = currentHours >= 12 ? 'PM' : 'AM';
        html += `
            <div class="current-time-indicator" style="top: ${indicatorTop}px;"></div>
            <div class="current-time-label" style="top: ${indicatorTop - 15}px;">
                ${displayHour}:${currentMinutes.toString().padStart(2, '0')} ${ampm}
            </div>
        `;
    }
    fallbackEvents.forEach(event => {
        const startTime = event.startTime.split(':');
        const endTime = event.endTime.split(':');
        const startHours = parseInt(startTime[0]);
        const startMinutes = parseInt(startTime[1]);
        const endHours = parseInt(endTime[0]);
        const endMinutes = parseInt(endTime[1]);
        const startTotalMinutes = startHours * 60 + startMinutes;
        const endTotalMinutes = endHours * 60 + endMinutes;
        const top = startTotalMinutes + TOP_OFFSET;
        const height = endTotalMinutes - startTotalMinutes;
        const isCurrent = currentTotalMinutes >= startTotalMinutes && 
                          currentTotalMinutes <= endTotalMinutes;
        if (isCurrent) currentPeriodFound = true;
        const formatTime = (hours, minutes) => {
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
            return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        };
        html += `
            <div class="event-item" 
                 style="top: ${top}px; height: ${height}px; left: 10px; right: 10px; background: rgba(255, 255, 255, 0.08); border-left-color: #b0b7c3;">
                <div class="event-time" style="color: #b0b7c3;">
                    ${formatTime(startHours, startMinutes)} – ${formatTime(endHours, endMinutes)}
                </div>
                <div class="event-title" style="color: #b0b7c3;">
                    ${event.title} (Fallback)
                </div>
            </div>
        `;
    });
    if (!currentPeriodFound) {
        const indicatorTop = Math.max(TOP_OFFSET, Math.min(1440, currentTotalMinutes + TOP_OFFSET));
        html += `
            <div class="event-item" style="top: ${indicatorTop}px; height: 50px; background: rgba(255, 193, 7, 0.1); border-left-color: #ffc107;">
                <div class="event-title" style="color: #ffd54f;">
                    Using fallback schedule
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
    document.getElementById('cacheStatus').textContent = 'Using fallback schedule';
}