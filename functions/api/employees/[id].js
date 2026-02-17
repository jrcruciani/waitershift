export async function onRequestPut(context) {
    const db = context.env.DB;
    const id = context.params.id;
    const { name } = await context.request.json();

    if (!name || !name.trim()) {
        return Response.json(
            { error: "El nombre es obligatorio" },
            { status: 400 }
        );
    }

    await db.prepare(
        "UPDATE employees SET name = ? WHERE id = ?"
    ).bind(name.trim(), id).run();

    return Response.json({ id: Number(id), name: name.trim() });
}

export async function onRequestDelete(context) {
    const db = context.env.DB;
    const id = context.params.id;

    // Delete schedules first (in case CASCADE doesn't work), then employee
    await db.batch([
        db.prepare("DELETE FROM schedules WHERE employee_id = ?").bind(id),
        db.prepare("DELETE FROM employees WHERE id = ?").bind(id),
    ]);

    return Response.json({ success: true });
}
