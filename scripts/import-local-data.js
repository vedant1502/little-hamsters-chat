const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { getDatabaseSslConfig } = require("../lib/database-ssl");

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const dataFile = path.resolve(process.env.APP_DATA_PATH || path.join(__dirname, "..", "data", "app.json"));

if (!databaseUrl) {
  console.error("Set DATABASE_URL to your Supabase session-pooler connection string first.");
  process.exitCode = 1;
} else if (!fs.existsSync(dataFile)) {
  console.error(`Local data file not found: ${dataFile}`);
  process.exitCode = 1;
} else {
  importLocalData().catch((error) => {
    console.error("Local data import failed:", error.message);
    process.exitCode = 1;
  });
}

async function importLocalData() {
  const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  state.users ||= [];
  state.sessions ||= {};
  state.messages ||= [];
  state.groups ||= [];
  for (const user of state.users) {
    user.hiddenMessageIds ||= [];
    user.hamsterDesign ||= "classic";
  }
  for (const group of state.groups) group.bannedUserIds ||= [];

  const pool = new Pool({ connectionString: databaseUrl, ssl: getDatabaseSslConfig(), max: 1, connectionTimeoutMillis: 10000 });
  let client;
  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.little_hamsters_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("ALTER TABLE public.little_hamsters_state ENABLE ROW LEVEL SECURITY");
    await client.query("REVOKE ALL ON TABLE public.little_hamsters_state FROM PUBLIC, anon, authenticated, service_role");
    await client.query("BEGIN");
    const result = await client.query("SELECT state FROM public.little_hamsters_state WHERE id = 1 FOR UPDATE");
    if (result.rowCount && !isEmpty(result.rows[0].state)) {
      throw new Error("The Supabase database already contains app data, so nothing was overwritten.");
    }
    if (result.rowCount) {
      await client.query(
        "UPDATE public.little_hamsters_state SET state = $1::jsonb, updated_at = now() WHERE id = 1",
        [JSON.stringify(state)]
      );
    } else {
      await client.query("INSERT INTO public.little_hamsters_state (id, state) VALUES (1, $1::jsonb)", [JSON.stringify(state)]);
    }
    await client.query("COMMIT");
    console.log(`Imported ${state.users.length} accounts, ${state.groups.length} groups, and ${state.messages.length} messages.`);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

function isEmpty(state) {
  return (state.users || []).length === 0
    && (state.groups || []).length === 0
    && (state.messages || []).length === 0
    && Object.keys(state.sessions || {}).length === 0;
}
