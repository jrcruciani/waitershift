/**
 * API Client for WaiterShift
 * Communicates with Cloudflare Pages Functions + D1
 */
const API = {
    baseUrl: '/api',

    async _request(path, options = {}) {
        const url = this.baseUrl + path;
        const config = {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        };
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }
        const response = await fetch(url, config);
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Error de red' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        return response.json();
    },

    // ---- Database init ----
    async initDatabase() {
        return this._request('/init', { method: 'POST' });
    },

    // ---- Employees ----
    async getEmployees() {
        return this._request('/employees');
    },

    async createEmployee(name) {
        return this._request('/employees', {
            method: 'POST',
            body: { name },
        });
    },

    async updateEmployee(id, name) {
        return this._request(`/employees/${id}`, {
            method: 'PUT',
            body: { name },
        });
    },

    async deleteEmployee(id) {
        return this._request(`/employees/${id}`, {
            method: 'DELETE',
        });
    },

    // ---- Schedules ----
    async getSchedules(weekStart) {
        return this._request(`/schedules?week=${encodeURIComponent(weekStart)}`);
    },

    async saveSchedules(weekStart, data) {
        return this._request('/schedules', {
            method: 'PUT',
            body: { week_start: weekStart, data },
        });
    },

    // ---- Weeks ----
    async getWeeks() {
        return this._request('/weeks');
    },
};
