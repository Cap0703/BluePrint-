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
    container.innerHTML = '<div class="loading">Loading schedule...</div>';
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
        container.innerHTML = '<div class="error">No schedule found</div>';
        return;
    }
    const now = new Date();
    const currentTime =
        now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');
    let currentFound = false;
    const html = events.map(event => {
        const isCurrent = currentTime >= event.startTime && currentTime <= event.endTime;
        if (isCurrent) currentFound = true;
        return `
            <div class="event-item ${isCurrent ? 'current-period' : ''}">
                <div class="event-time">
                    ${event.startTime} – ${event.endTime} ${isCurrent ? '🟢' : ''}
                </div>
                <div class="event-title">${event.title}</div>
            </div>
        `;
    }).join('');
    container.innerHTML = (!currentFound
        ? `<div class="event-item no-current-period">
               <div class="event-time">No current period – Outside school hours</div>
           </div>`
        : '') + html;
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
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                      now.getMinutes().toString().padStart(2, '0');
    let eventsHTML = '';
    let currentPeriodFound = false;
    fallbackEvents.forEach(event => {
        const isCurrentPeriod = currentTime >= event.startTime && 
                              currentTime <= event.endTime;
        if (isCurrentPeriod) {
            currentPeriodFound = true;
        }
        eventsHTML += `
            <div class="event-item ${isCurrentPeriod ? 'current-period' : ''}">
                <div class="event-time">
                    ${event.startTime} - ${event.endTime}
                    ${isCurrentPeriod ? ' 🟢' : ''}
                </div>
                <div class="event-title">${event.title} (Fallback)</div>
            </div>
        `;
    });
    if (!currentPeriodFound) {
        eventsHTML = `
            <div class="event-item no-current-period">
                <div class="event-time">No current period - Outside of school hours</div>
            </div>
        ` + eventsHTML;
    }
    container.innerHTML = eventsHTML;
    document.getElementById('cacheStatus').textContent = 'Cache: Using fallback schedule';
}