const CALENDAR_START_HOUR = 6;
const CALENDAR_END_HOUR = 24;
const MINUTE_HEIGHT = 1;
const TOP_OFFSET = 0;

function minuteToCalendarOffset(totalMinutes) {
    return ((totalMinutes - (CALENDAR_START_HOUR * 60)) * MINUTE_HEIGHT) + TOP_OFFSET;
}

function formatDisplayTime(hours, minutes) {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function filteredCalendarEvents(events) {
    return (events || []).filter(event => {
        const title = String(event.title || '').toLowerCase();
        return !(title.includes('lunch') || title.includes('break') || title.includes('transition'));
    });
}

function updateCalendarLayoutMetrics() {
    const grid = document.querySelector('.calendar-grid');
    if (grid) {
        grid.style.minHeight = `${minuteToCalendarOffset(CALENDAR_END_HOUR * 60)}px`;
    }
}

function buildTimeMarkers() {
    let html = '';
    for (let hour = CALENDAR_START_HOUR; hour < CALENDAR_END_HOUR; hour += 1) {
        html += `<div class="hour-marker" style="top: ${minuteToCalendarOffset(hour * 60)}px;"></div>`;
        html += `<div class="half-hour-marker" style="top: ${minuteToCalendarOffset((hour * 60) + 30)}px;"></div>`;
    }
    return html;
}

function buildCurrentTimeMarkup(currentTotalMinutes) {
    if (currentTotalMinutes < CALENDAR_START_HOUR * 60 || currentTotalMinutes >= CALENDAR_END_HOUR * 60) {
        return '';
    }

    const now = new Date();
    const indicatorTop = minuteToCalendarOffset(currentTotalMinutes);
    return `
        <div class="current-time-indicator" style="top: ${indicatorTop}px;"></div>
        <div class="current-time-label" style="top: ${indicatorTop - 15}px;">
            ${formatDisplayTime(now.getHours(), now.getMinutes())}
        </div>
    `;
}

function buildEventMarkup(event, currentTotalMinutes, isFallback = false) {
    const [startHourRaw, startMinuteRaw] = String(event.startTime || '').split(':');
    const [endHourRaw, endMinuteRaw] = String(event.endTime || '').split(':');
    const startHours = Number(startHourRaw);
    const startMinutes = Number(startMinuteRaw);
    const endHours = Number(endHourRaw);
    const endMinutes = Number(endMinuteRaw);

    if (![startHours, startMinutes, endHours, endMinutes].every(Number.isFinite)) {
        return { html: '', isCurrent: false };
    }

    const startTotalMinutes = (startHours * 60) + startMinutes;
    const endTotalMinutes = (endHours * 60) + endMinutes;
    const isCurrent = currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
    const top = minuteToCalendarOffset(startTotalMinutes);
    const height = Math.max((endTotalMinutes - startTotalMinutes) * MINUTE_HEIGHT, 32);
    const timeColor = isFallback ? '#b0b7c3' : '';
    const titleColor = isFallback ? '#b0b7c3' : '';
    const fallbackStyles = isFallback
        ? 'background: rgba(255, 255, 255, 0.08); border-left-color: #b0b7c3;'
        : '';

    return {
        isCurrent,
        html: `
            <div class="event-item ${isCurrent && !isFallback ? 'current-period' : ''}" style="top: ${top}px; height: ${height}px; left: 10px; right: 10px; ${fallbackStyles}">
                <div class="event-time" style="${timeColor ? `color: ${timeColor};` : ''}">
                    ${formatDisplayTime(startHours, startMinutes)} - ${formatDisplayTime(endHours, endMinutes)}
                </div>
                <div class="event-title" style="${titleColor ? `color: ${titleColor};` : ''}">
                    ${event.title}${isFallback ? ' (Fallback)' : ''}
                </div>
            </div>
        `
    };
}

function buildNoCurrentPeriodMarkup(currentTotalMinutes, message, styles = {}) {
    const maxOffset = minuteToCalendarOffset(CALENDAR_END_HOUR * 60);
    const boundedMinutes = Math.max(CALENDAR_START_HOUR * 60, Math.min(CALENDAR_END_HOUR * 60, currentTotalMinutes));
    const top = Math.max(TOP_OFFSET, Math.min(maxOffset, minuteToCalendarOffset(boundedMinutes)));
    const background = styles.background || 'rgba(255, 82, 82, 0.1)';
    const borderColor = styles.borderColor || '#ff5252';
    const titleColor = styles.titleColor || '#ff8a80';

    return `
        <div class="event-item" style="top: ${top}px; height: 50px; background: ${background}; border-left-color: ${borderColor};">
            <div class="event-title" style="color: ${titleColor};">
                ${message}
            </div>
        </div>
    `;
}

async function getPeriodsToday() {
    const calendarData = await getCalendarEvents();
    return filteredCalendarEvents(calendarData.events);
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
                { title: 'Period 1', startTime: '08:00', endTime: '09:25' },
                { title: 'Period 2', startTime: '09:30', endTime: '10:50' },
                { title: 'Period 3', startTime: '11:10', endTime: '12:30' },
                { title: 'Period 4', startTime: '13:05', endTime: '14:25' }
            ],
            lastUpdated: new Date().toISOString()
        };
    }
}

function displayEvents(calendarData) {
    const container = document.getElementById('eventsContainer');
    updateCalendarLayoutMetrics();

    if (calendarData.lastUpdated) {
        updateCacheStatus(calendarData.lastUpdated);
    }

    const events = filteredCalendarEvents(calendarData.events);
    if (!events.length) {
        container.innerHTML = '<div class="no-events">No schedule found for today</div>';
        return;
    }

    const now = new Date();
    const currentTotalMinutes = (now.getHours() * 60) + now.getMinutes();
    let html = buildTimeMarkers();
    html += buildCurrentTimeMarkup(currentTotalMinutes);

    let currentPeriodFound = false;
    events.forEach(event => {
        const renderedEvent = buildEventMarkup(event, currentTotalMinutes);
        currentPeriodFound = currentPeriodFound || renderedEvent.isCurrent;
        html += renderedEvent.html;
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
        html += buildNoCurrentPeriodMarkup(currentTotalMinutes, `${message} • No current period`);
    }

    container.innerHTML = html;
}

function displayFallbackEvents() {
    const fallbackEvents = [
        { title: 'Period 1', startTime: '08:00', endTime: '09:25' },
        { title: 'Period 2', startTime: '09:30', endTime: '10:50' },
        { title: 'Period 3', startTime: '11:10', endTime: '12:30' },
        { title: 'Period 4', startTime: '13:05', endTime: '14:25' }
    ];

    const container = document.getElementById('eventsContainer');
    updateCalendarLayoutMetrics();

    const now = new Date();
    const currentTotalMinutes = (now.getHours() * 60) + now.getMinutes();
    let html = buildTimeMarkers();
    html += buildCurrentTimeMarkup(currentTotalMinutes);

    let currentPeriodFound = false;
    fallbackEvents.forEach(event => {
        const renderedEvent = buildEventMarkup(event, currentTotalMinutes, true);
        currentPeriodFound = currentPeriodFound || renderedEvent.isCurrent;
        html += renderedEvent.html;
    });

    if (!currentPeriodFound) {
        html += buildNoCurrentPeriodMarkup(currentTotalMinutes, 'Using fallback schedule', {
            background: 'rgba(255, 193, 7, 0.1)',
            borderColor: '#ffc107',
            titleColor: '#ffd54f'
        });
    }

    container.innerHTML = html;
    document.getElementById('cacheStatus').textContent = 'Using fallback schedule';
}
