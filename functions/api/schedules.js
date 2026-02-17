export async function onRequestGet(context) {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const weekStart = url.searchParams.get("week");

    if (!weekStart) {
        return Response.json(
            { error: "El parametro 'week' es obligatorio (YYYY-MM-DD)" },
            { status: 400 }
        );
    }

    const { results } = await db.prepare(`
        SELECT s.*, e.name as employee_name
        FROM schedules s
        JOIN employees e ON s.employee_id = e.id
        WHERE s.week_start = ?
        ORDER BY e.sort_order, e.id, s.day_index
    `).bind(weekStart).all();

    return Response.json(results);
}

export async function onRequestPut(context) {
    const db = context.env.DB;
    const { week_start, data } = await context.request.json();

    if (!week_start || !data) {
        return Response.json(
            { error: "Se requieren 'week_start' y 'data'" },
            { status: 400 }
        );
    }

    const statements = [];

    // Upsert the week
    statements.push(
        db.prepare(
            "INSERT OR IGNORE INTO weeks (week_start) VALUES (?)"
        ).bind(week_start)
    );

    // Upsert each schedule entry
    for (const emp of data) {
        for (const day of emp.days) {
            statements.push(
                db.prepare(`
                    INSERT OR REPLACE INTO schedules
                    (employee_id, week_start, day_index, shift_type, shift1_start, shift1_end, shift2_start, shift2_end)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    emp.employee_id,
                    week_start,
                    day.day_index,
                    day.shift_type || 'single',
                    day.shift1_start || '',
                    day.shift1_end || '',
                    day.shift2_start || '',
                    day.shift2_end || ''
                )
            );
        }
    }

    await db.batch(statements);

    return Response.json({ success: true, saved: data.length });
}
