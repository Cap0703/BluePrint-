document.addEventListener('DOMContentLoaded', () => {
    fetchAnalytics();
});

document.addEventListener('DOMContentLoaded', () => {
    fetchAnalytics();
});

async function fetchAnalytics() {
    try {
        const response = await fetch('/api/logs/analytics');
        const data = await response.json();
        data.forEach(item => item.total = Number(item.total));
        const totalScans = data.reduce((sum, item) => sum + item.total, 0);
        const uniqueStudents = new Set(data.map(item => item.student_id)).size;
        const mostCommonLocation = data.reduce(
            (max, item) => item.total > max.total ? item : max,
            { total: 0 }
        ).scanner_location;
        displayAnalytics(totalScans, uniqueStudents, mostCommonLocation);
    } catch (err) {
        console.error("Failed to fetch analytics:", err);
    }
}

function displayAnalytics(totalScans, uniqueStudents, mostCommonLocation) {
    const container = document.getElementById('analytics-card');

    container.innerHTML = `
        <h2>Analytics</h2>
        <p>Total Scans: ${totalScans}</p>
        <p>Unique Students: ${uniqueStudents}</p>
        <p>Most Common Location: ${mostCommonLocation}</p>
    `;
}