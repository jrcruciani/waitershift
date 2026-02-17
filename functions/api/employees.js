export async function onRequestGet(context) {
    const db = context.env.DB;
    const { results } = await db.prepare(
        "SELECT * FROM employees ORDER BY sort_order, id"
    ).all();

    return Response.json(results);
}

export async function onRequestPost(context) {
    const db = context.env.DB;
    const { name } = await context.request.json();

    if (!name || !name.trim()) {
        return Response.json(
            { error: "El nombre es obligatorio" },
            { status: 400 }
        );
    }

    const result = await db.prepare(
        "INSERT INTO employees (name) VALUES (?)"
    ).bind(name.trim()).run();

    return Response.json({
        id: result.meta.last_row_id,
        name: name.trim(),
        sort_order: 0,
    }, { status: 201 });
}
