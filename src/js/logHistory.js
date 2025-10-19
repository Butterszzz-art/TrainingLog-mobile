function renderLogHistory() {
    const historyContainer = document.getElementById('historyContainer');
    if (!historyContainer) {
        return;
    }
    const resistance = JSON.parse(localStorage.getItem('resistanceLogs') || '[]');
    const cardio = JSON.parse(localStorage.getItem('cardioLogs') || '[]');
    const bodyweight = JSON.parse(localStorage.getItem('bodyweightLogs') || '[]');
    const crossfit = JSON.parse(localStorage.getItem('crossfitWorkouts') || '[]');

    const allLogs = [];
    resistance.forEach(log => allLogs.push({ type: 'Resistance', date: log.date, details: log }));
    cardio.forEach(log => allLogs.push({ type: 'Cardio', date: log.date, details: log }));
    bodyweight.forEach(log => allLogs.push({ type: 'Bodyweight', date: log.date, details: log }));
    crossfit.forEach(log => allLogs.push({ type: 'CrossFit', date: log.date || log.time, details: log }));

    allLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!allLogs.length) {
        historyContainer.innerHTML = '<p>No log entries yet.</p>';
        return;
    }

    const rows = allLogs
        .map(
            log =>
                `<tr><td>${log.date}</td><td>${log.type}</td><td>${JSON.stringify(log.details)}</td></tr>`
        )
        .join('');

    historyContainer.innerHTML =
        '<table><thead><tr><th>Date</th><th>Type</th><th>Details</th></tr></thead><tbody>' +
        rows +
        '</tbody></table>';
}

document.addEventListener('DOMContentLoaded', renderLogHistory);

