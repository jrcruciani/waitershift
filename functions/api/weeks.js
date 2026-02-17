export async function onRequestGet(context) {
    const db = context.env.DB;
    const { results } = await db.prepare(
        "SELECT * FROM weeks ORDER BY week_start DESC"
    ).all();

    return Response.json(results);
}
