/**
 * WaiterShift - Main Application Logic
 * Refactored to work with Cloudflare D1 via API + localStorage cache
 */

let employees = []; // Each: { id, name, sort_order, schedule: [{type, shift1:{start,end}, shift2:{start,end}}] }
let currentWeekStart = ''; // YYYY-MM-DD (always a Monday)
let saveTimer = null;
let isOnline = navigator.onLine;

const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

// ==================== UTILITIES ====================

function calculateHours(start, end) {
    if (!start || !end) return 0;
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    let startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    if (endMinutes < startMinutes) {
        endMinutes += 24 * 60;
    }
    return (endMinutes - startMinutes) / 60;
}

function calculateDayHours(day) {
    const shift1Hours = calculateHours(day.shift1.start, day.shift1.end);
    const shift2Hours = calculateHours(day.shift2.start, day.shift2.end);
    return shift1Hours + shift2Hours;
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

function getMonday(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const day = date.getDay();
    const diffToMonday = (day === 0) ? -6 : 1 - day;
    const monday = new Date(date);
    monday.setDate(date.getDate() + diffToMonday);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, '0');
    const d = String(monday.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function createEmptySchedule() {
    return Array(7).fill(null).map(() => ({
        type: 'single',
        shift1: { start: '', end: '' },
        shift2: { start: '', end: '' },
    }));
}

// ==================== SYNC STATUS ====================

function setSyncStatus(status, text) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.className = 'sync-status ' + status;
    el.querySelector('.text').textContent = text;
}

// ==================== LOCAL STORAGE CACHE ====================

function saveToLocalStorage() {
    try {
        const data = {
            employees: employees,
            weekStart: currentWeekStart,
        };
        localStorage.setItem('horarios_data', JSON.stringify(data));
    } catch (e) {
        console.error('Error saving to localStorage:', e);
    }
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('horarios_data');
        if (saved) {
            const data = JSON.parse(saved);
            employees = data.employees || [];
            currentWeekStart = data.weekStart || '';
            return true;
        }
    } catch (e) {
        console.error('Error loading from localStorage:', e);
    }
    return false;
}

// ==================== SERVER SYNC ====================

function debounceSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveToLocalStorage();
    setSyncStatus('saving', 'Guardando...');
    saveTimer = setTimeout(() => saveToServer(), 800);
}

async function saveToServer() {
    if (!currentWeekStart || employees.length === 0) {
        setSyncStatus('', 'Conectado');
        return;
    }

    try {
        const data = employees.map(emp => ({
            employee_id: emp.id,
            days: emp.schedule.map((day, idx) => ({
                day_index: idx,
                shift_type: day.type,
                shift1_start: day.shift1.start,
                shift1_end: day.shift1.end,
                shift2_start: day.shift2.start,
                shift2_end: day.shift2.end,
            })),
        }));

        await API.saveSchedules(currentWeekStart, data);
        setSyncStatus('', 'Guardado ✓');
        setTimeout(() => setSyncStatus('', 'Conectado'), 2000);
    } catch (err) {
        console.error('Error saving to server:', err);
        setSyncStatus('error', 'Error al guardar');
    }
}

async function loadFromServer() {
    try {
        // Load employees from server
        const serverEmployees = await API.getEmployees();

        // Load schedules for current week
        let serverSchedules = [];
        if (currentWeekStart) {
            serverSchedules = await API.getSchedules(currentWeekStart);
        }

        // Build employees with their schedules
        employees = serverEmployees.map(emp => {
            const schedule = createEmptySchedule();

            // Fill in schedule data from server
            const empSchedules = serverSchedules.filter(s => s.employee_id === emp.id);
            for (const s of empSchedules) {
                if (s.day_index >= 0 && s.day_index < 7) {
                    schedule[s.day_index] = {
                        type: s.shift_type || 'single',
                        shift1: { start: s.shift1_start || '', end: s.shift1_end || '' },
                        shift2: { start: s.shift2_start || '', end: s.shift2_end || '' },
                    };
                }
            }

            return {
                id: emp.id,
                name: emp.name,
                sort_order: emp.sort_order,
                schedule: schedule,
            };
        });

        saveToLocalStorage();
        renderSchedule();
        setSyncStatus('', 'Conectado');
    } catch (err) {
        console.error('Error loading from server:', err);
        setSyncStatus('offline', 'Sin conexion');
    }
}

// ==================== MIGRATION ====================

async function checkMigration() {
    try {
        // Check if old localStorage format exists
        const oldData = localStorage.getItem('horarios_camareros');
        if (!oldData) return;

        const oldEmployees = JSON.parse(oldData);
        if (!oldEmployees || oldEmployees.length === 0) return;

        // Check if server already has employees
        const serverEmployees = await API.getEmployees();
        if (serverEmployees.length > 0) {
            // Server already has data, no need to migrate
            localStorage.removeItem('horarios_camareros');
            return;
        }

        // Show migration banner
        document.getElementById('migrationBanner').classList.add('show');
    } catch (err) {
        // If server is unreachable, don't show banner
        console.log('Migration check skipped (server unavailable)');
    }
}

async function migrateLocalData() {
    const banner = document.getElementById('migrationBanner');
    try {
        const oldData = localStorage.getItem('horarios_camareros');
        if (!oldData) return;

        const oldEmployees = JSON.parse(oldData);
        const oldWeek = localStorage.getItem('horarios_semana');

        // Create employees on server
        for (const emp of oldEmployees) {
            const created = await API.createEmployee(emp.name);

            // If we have schedule data and a week, save it
            if (oldWeek && emp.schedule) {
                const weekStart = getMonday(oldWeek);
                const days = emp.schedule.map((day, idx) => ({
                    day_index: idx,
                    shift_type: day.type || 'single',
                    shift1_start: day.shift1 ? day.shift1.start || '' : '',
                    shift1_end: day.shift1 ? day.shift1.end || '' : '',
                    shift2_start: day.shift2 ? day.shift2.start || '' : '',
                    shift2_end: day.shift2 ? day.shift2.end || '' : '',
                }));

                await API.saveSchedules(weekStart, [{
                    employee_id: created.id,
                    days: days,
                }]);
            }
        }

        // Clean up old data
        localStorage.removeItem('horarios_camareros');
        banner.classList.remove('show');

        // Reload from server
        await loadFromServer();
        alert('Datos migrados exitosamente al servidor.');
    } catch (err) {
        console.error('Migration error:', err);
        alert('Error al migrar datos: ' + err.message);
    }
}

function dismissMigration() {
    document.getElementById('migrationBanner').classList.remove('show');
    localStorage.removeItem('horarios_camareros');
}

// ==================== RENDER ====================

function renderSchedule() {
    const list = document.getElementById('employeeList');
    list.innerHTML = '';

    employees.forEach((emp, empIndex) => {
        const row = document.createElement('div');
        row.className = 'employee-row';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'employee-name';

        const weekHours = emp.schedule.reduce((sum, day) => sum + calculateDayHours(day), 0);

        nameDiv.innerHTML = `
            <button class="delete-btn" onclick="deleteEmployee(${empIndex})" title="Eliminar camarero">&times;</button>
            <div class="employee-info">
                <div class="avatar">${getInitials(emp.name)}</div>
                <span>${emp.name}</span>
            </div>
            <div class="employee-weekly-hours no-print">⏱️ ${weekHours.toFixed(1)}h</div>
            <div class="employee-actions">
                <button class="action-btn print-btn" onclick="printEmployee(${empIndex})" title="Imprimir horario">
                    🖨️
                </button>
                <button class="action-btn whatsapp-btn" onclick="shareEmployeeWhatsApp(${empIndex})" title="Enviar por WhatsApp">
                    📱
                </button>
            </div>
        `;
        row.appendChild(nameDiv);

        emp.schedule.forEach((day, dayIndex) => {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'day-cell';

            const dayHours = calculateDayHours(day);
            const dayHeader = `<div class="day-cell-header">${days[dayIndex]}</div>`;

            if (day.type === 'rest') {
                dayDiv.innerHTML = dayHeader + `
                    <input type="text" class="time-input rest-day" value="DESCANSO" readonly>
                    <div class="button-row">
                        <button class="rest-toggle active" onclick="toggleRest(${empIndex}, ${dayIndex})">Desc.</button>
                        <button class="single-toggle" onclick="toggleNormal(${empIndex}, ${dayIndex})">Norm.</button>
                        <button class="guard-toggle" onclick="toggleGuard(${empIndex}, ${dayIndex})">Guar.</button>
                    </div>
                `;
            } else if (day.type === 'normal') {
                const warningClass = dayHours > 9 ? 'style="border-color: var(--secondary); background: #ffe6e6;"' : '';
                dayDiv.innerHTML = dayHeader + `
                    <input type="text" class="time-input normal-day" value="NORMAL (${dayHours.toFixed(1)}h)" readonly>
                    <div class="shift-group">
                        <div class="shift-label">Turno 1</div>
                        <div class="shift-inputs">
                            <input type="time" class="time-input" value="${day.shift1.start}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift1', 'start', this.value)" ${warningClass}>
                            <span>-</span>
                            <input type="time" class="time-input" value="${day.shift1.end}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift1', 'end', this.value)" ${warningClass}>
                        </div>
                    </div>
                    <div class="shift-group">
                        <div class="shift-label">Turno 2</div>
                        <div class="shift-inputs">
                            <input type="time" class="time-input" value="${day.shift2.start}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift2', 'start', this.value)" ${warningClass}>
                            <span>-</span>
                            <input type="time" class="time-input" value="${day.shift2.end}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift2', 'end', this.value)" ${warningClass}>
                        </div>
                    </div>
                    <div class="button-row">
                        <button class="rest-toggle" onclick="toggleRest(${empIndex}, ${dayIndex})">Desc.</button>
                        <button class="single-toggle active" onclick="toggleNormal(${empIndex}, ${dayIndex})">Norm.</button>
                        <button class="guard-toggle" onclick="toggleGuard(${empIndex}, ${dayIndex})">Guar.</button>
                    </div>
                `;
            } else if (day.type === 'guard') {
                const warningClass = dayHours > 9 ? 'style="border-color: var(--secondary); background: #ffe6e6;"' : '';
                dayDiv.innerHTML = dayHeader + `
                    <input type="text" class="time-input guard-day" value="GUARDIA (${dayHours.toFixed(1)}h)" readonly>
                    <div class="shift-group">
                        <div class="shift-label">Horario Corrido</div>
                        <div class="shift-inputs">
                            <input type="time" class="time-input" value="${day.shift1.start}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift1', 'start', this.value)" ${warningClass}>
                            <span>-</span>
                            <input type="time" class="time-input" value="${day.shift1.end}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift1', 'end', this.value)" ${warningClass}>
                        </div>
                    </div>
                    <div class="button-row">
                        <button class="rest-toggle" onclick="toggleRest(${empIndex}, ${dayIndex})">Desc.</button>
                        <button class="single-toggle" onclick="toggleNormal(${empIndex}, ${dayIndex})">Norm.</button>
                        <button class="guard-toggle active" onclick="toggleGuard(${empIndex}, ${dayIndex})">Guar.</button>
                    </div>
                `;
            } else {
                // single shift
                const warningClass = dayHours > 9 ? 'style="border-color: var(--secondary); background: #ffe6e6;"' : '';
                dayDiv.innerHTML = dayHeader + `
                    <div class="shift-group">
                        <div class="shift-label">Turno</div>
                        <div class="shift-inputs">
                            <input type="time" class="time-input" value="${day.shift1.start}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift1', 'start', this.value)" ${warningClass}>
                            <span>-</span>
                            <input type="time" class="time-input" value="${day.shift1.end}"
                                onchange="updateSchedule(${empIndex}, ${dayIndex}, 'shift1', 'end', this.value)" ${warningClass}>
                        </div>
                    </div>
                    <div class="button-row">
                        <button class="rest-toggle" onclick="toggleRest(${empIndex}, ${dayIndex})">Desc.</button>
                        <button class="single-toggle" onclick="toggleNormal(${empIndex}, ${dayIndex})">Norm.</button>
                        <button class="guard-toggle" onclick="toggleGuard(${empIndex}, ${dayIndex})">Guar.</button>
                    </div>
                `;
            }

            row.appendChild(dayDiv);
        });

        list.appendChild(row);
    });

    updateStats();
}

// ==================== SCHEDULE ACTIONS ====================

function updateSchedule(empIndex, dayIndex, shift, field, value) {
    employees[empIndex].schedule[dayIndex][shift][field] = value;
    renderSchedule();
    debounceSave();
}

function toggleRest(empIndex, dayIndex) {
    const day = employees[empIndex].schedule[dayIndex];
    if (day.type === 'rest') {
        day.type = 'single';
        day.shift1.start = '09:00';
        day.shift1.end = '17:00';
        day.shift2.start = '';
        day.shift2.end = '';
    } else {
        day.type = 'rest';
        day.shift1.start = '';
        day.shift1.end = '';
        day.shift2.start = '';
        day.shift2.end = '';
    }
    renderSchedule();
    debounceSave();
}

function toggleNormal(empIndex, dayIndex) {
    const day = employees[empIndex].schedule[dayIndex];
    if (day.type === 'normal') {
        day.type = 'single';
        day.shift1.start = '09:00';
        day.shift1.end = '17:00';
        day.shift2.start = '';
        day.shift2.end = '';
    } else {
        day.type = 'normal';
        day.shift1.start = '09:00';
        day.shift1.end = '13:00';
        day.shift2.start = '17:00';
        day.shift2.end = '21:00';
    }
    renderSchedule();
    debounceSave();
}

function toggleGuard(empIndex, dayIndex) {
    const day = employees[empIndex].schedule[dayIndex];
    if (day.type === 'guard') {
        day.type = 'single';
        day.shift1.start = '09:00';
        day.shift1.end = '17:00';
        day.shift2.start = '';
        day.shift2.end = '';
    } else {
        day.type = 'guard';
        day.shift1.start = '08:00';
        day.shift1.end = '20:00';
        day.shift2.start = '';
        day.shift2.end = '';
    }
    renderSchedule();
    debounceSave();
}

// ==================== EMPLOYEE ACTIONS ====================

async function addEmployee() {
    const input = document.getElementById('newEmployeeName');
    const name = input.value.trim();
    if (!name) {
        alert('Por favor, ingresa un nombre para el camarero');
        return;
    }

    try {
        const created = await API.createEmployee(name);
        employees.push({
            id: created.id,
            name: created.name,
            sort_order: created.sort_order || 0,
            schedule: createEmptySchedule(),
        });
        input.value = '';
        renderSchedule();
        saveToLocalStorage();
        setSyncStatus('', 'Guardado ✓');
        setTimeout(() => setSyncStatus('', 'Conectado'), 2000);
    } catch (err) {
        console.error('Error adding employee:', err);
        // Fallback: add locally with temporary negative id
        const tempId = -Date.now();
        employees.push({
            id: tempId,
            name: name,
            sort_order: 0,
            schedule: createEmptySchedule(),
        });
        input.value = '';
        renderSchedule();
        saveToLocalStorage();
        setSyncStatus('error', 'Guardado local (sin conexion)');
    }
}

async function deleteEmployee(empIndex) {
    if (!confirm('¿Estas seguro de eliminar este camarero?')) return;

    const emp = employees[empIndex];

    try {
        if (emp.id > 0) {
            await API.deleteEmployee(emp.id);
        }
    } catch (err) {
        console.error('Error deleting from server:', err);
    }

    employees.splice(empIndex, 1);
    renderSchedule();
    saveToLocalStorage();
    debounceSave();
}

async function clearAll() {
    if (!confirm('¿Estas seguro de eliminar todos los horarios?')) return;

    try {
        for (const emp of employees) {
            if (emp.id > 0) {
                await API.deleteEmployee(emp.id);
            }
        }
    } catch (err) {
        console.error('Error clearing from server:', err);
    }

    employees = [];
    renderSchedule();
    saveToLocalStorage();
}

// ==================== PRINT & SHARE ====================

function printEmployee(empIndex) {
    const allRows = document.querySelectorAll('.employee-row');
    allRows.forEach((row, index) => {
        if (index !== empIndex) {
            row.classList.add('print-hidden');
        }
    });
    window.onafterprint = function () {
        allRows.forEach(row => row.classList.remove('print-hidden'));
        window.onafterprint = null;
    };
    window.print();
}

function shareEmployeeWhatsApp(empIndex) {
    const emp = employees[empIndex];

    let scheduleText = `📋 *HORARIO SEMANAL*\n\n`;
    scheduleText += `👤 *${emp.name}*\n\n`;

    let totalWeek = 0;

    emp.schedule.forEach((day, idx) => {
        const dayName = days[idx];
        const dayHours = calculateDayHours(day);
        totalWeek += dayHours;

        if (day.type === 'rest') {
            scheduleText += `📅 *${dayName}*: 🛌 DESCANSO\n`;
        } else if (day.type === 'normal') {
            const t1 = day.shift1.start && day.shift1.end ?
                `${day.shift1.start}-${day.shift1.end}` : '';
            const t2 = day.shift2.start && day.shift2.end ?
                `${day.shift2.start}-${day.shift2.end}` : '';

            if (t1 && t2) {
                scheduleText += `📅 *${dayName}*: ${t1} / ${t2} (${dayHours.toFixed(1)}h)\n`;
            } else if (t1) {
                scheduleText += `📅 *${dayName}*: ${t1} (${dayHours.toFixed(1)}h)\n`;
            } else if (t2) {
                scheduleText += `📅 *${dayName}*: ${t2} (${dayHours.toFixed(1)}h)\n`;
            } else {
                scheduleText += `📅 *${dayName}*: -\n`;
            }
        } else if (day.type === 'guard') {
            const t1 = day.shift1.start && day.shift1.end ?
                `${day.shift1.start}-${day.shift1.end}` : '';
            scheduleText += `📅 *${dayName}*: 🛡️ GUARDIA ${t1} (${dayHours.toFixed(1)}h)\n`;
        } else {
            const t1 = day.shift1.start && day.shift1.end ?
                `${day.shift1.start}-${day.shift1.end}` : '';
            if (t1) {
                scheduleText += `📅 *${dayName}*: ${t1} (${dayHours.toFixed(1)}h)\n`;
            } else {
                scheduleText += `📅 *${dayName}*: -\n`;
            }
        }
    });

    scheduleText += `\n⏰ *Total semanal*: ${totalWeek.toFixed(1)} horas\n`;

    const whatsappText = encodeURIComponent(scheduleText);
    const whatsappURL = `https://wa.me/?text=${whatsappText}`;
    window.open(whatsappURL, '_blank');
}

// ==================== STATS ====================

function updateStats() {
    const totalEmployeesEl = document.getElementById('totalEmployees');
    const totalHoursEl = document.getElementById('totalHours');
    const avgHoursEl = document.getElementById('avgHours');

    const totalEmployees = employees.length;
    let totalHours = 0;

    employees.forEach(emp => {
        emp.schedule.forEach(day => {
            totalHours += calculateDayHours(day);
        });
    });

    const avgHours = totalEmployees > 0 ? totalHours / totalEmployees : 0;

    totalEmployeesEl.textContent = totalEmployees;
    totalHoursEl.textContent = totalHours.toFixed(1) + 'h';
    avgHoursEl.textContent = avgHours.toFixed(1) + 'h';
}

// ==================== WEEK PICKER ====================

function updateWeekRange() {
    const picker = document.getElementById('weekDatePicker');
    if (!picker.value) return;

    currentWeekStart = getMonday(picker.value);

    const monday = new Date(currentWeekStart + 'T00:00:00');
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const rangeText = `${fmt(monday)} — ${fmt(sunday)}`;

    document.getElementById('weekRangeDisplay').textContent = rangeText;
    document.getElementById('weekRangePrint').textContent = `📅 Semana: ${rangeText}`;

    localStorage.setItem('horarios_semana', currentWeekStart);

    // Load schedules for this week from server
    loadFromServer();
}

function loadWeekRange() {
    const saved = localStorage.getItem('horarios_semana');
    if (saved) {
        currentWeekStart = getMonday(saved);
        document.getElementById('weekDatePicker').value = currentWeekStart;

        const monday = new Date(currentWeekStart + 'T00:00:00');
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        const rangeText = `${fmt(monday)} — ${fmt(sunday)}`;

        document.getElementById('weekRangeDisplay').textContent = rangeText;
        document.getElementById('weekRangePrint').textContent = `📅 Semana: ${rangeText}`;
    } else {
        // Default to current week
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        currentWeekStart = getMonday(`${y}-${m}-${d}`);
        document.getElementById('weekDatePicker').value = currentWeekStart;
        updateWeekRange();
        return; // updateWeekRange will call loadFromServer
    }
}

// ==================== ONLINE/OFFLINE ====================

window.addEventListener('online', () => {
    isOnline = true;
    setSyncStatus('', 'Reconectado');
    loadFromServer();
});

window.addEventListener('offline', () => {
    isOnline = false;
    setSyncStatus('offline', 'Sin conexion');
});

// ==================== INIT ====================

async function init() {
    // 1. Load week range (from localStorage or default to current week)
    loadWeekRange();

    // 2. Show cached data immediately
    if (loadFromLocalStorage()) {
        renderSchedule();
    }

    // 3. Fetch fresh data from server
    try {
        await loadFromServer();
    } catch (err) {
        console.log('Server unavailable, using cached data');
        setSyncStatus('offline', 'Sin conexion');
    }

    // 4. Check for data migration
    checkMigration();
}

// ==================== PWA INSTALL ====================

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Show install banner after a short delay
    setTimeout(() => {
        const banner = document.getElementById('installBanner');
        if (banner) banner.classList.add('show');
    }, 2000);
});

function installPWA() {
    const banner = document.getElementById('installBanner');
    if (!deferredPrompt) {
        if (banner) banner.classList.remove('show');
        return;
    }

    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('Usuario acepto instalar la app');
        }
        deferredPrompt = null;
        if (banner) banner.classList.remove('show');
    });
}

function dismissInstall() {
    const banner = document.getElementById('installBanner');
    if (banner) banner.classList.remove('show');
    deferredPrompt = null;
}

window.addEventListener('appinstalled', () => {
    console.log('App instalada exitosamente');
    const banner = document.getElementById('installBanner');
    if (banner) banner.classList.remove('show');
});

// Start the app
init();
