export async function onRequestPost(context) {
    const db = context.env.DB;

    await db.batch([
        db.prepare(`
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `),
        db.prepare(`
            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL,
                week_start TEXT NOT NULL,
                day_index INTEGER NOT NULL,
                shift_type TEXT NOT NULL DEFAULT 'single',
                shift1_start TEXT DEFAULT '',
                shift1_end TEXT DEFAULT '',
                shift2_start TEXT DEFAULT '',
                shift2_end TEXT DEFAULT '',
                FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
                UNIQUE(employee_id, week_start, day_index)
            )
        `),
        db.prepare(`
            CREATE TABLE IF NOT EXISTS weeks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start TEXT NOT NULL UNIQUE,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `),
    ]);

    return Response.json({ success: true, message: "Database initialized successfully" });
}
