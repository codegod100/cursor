import pg from "pg";
import { getMotherDuckToken } from "./secrets.js";

const { Pool } = pg;

const host = process.env.MOTHERDUCK_HOST ?? "pg.us-east-1-aws.motherduck.com";
const db = process.env.MOTHERDUCK_DB ?? "sample_data";

let pool;

export function isMotherDuckConfigured() {
  return Boolean(getMotherDuckToken());
}

function getPool() {
  const token = getMotherDuckToken();
  if (!token) {
    throw new Error("MOTHERDUCK_TOKEN environment variable is required");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: `postgresql://user:${token}@${host}:5432/${db}`,
      ssl: { rejectUnauthorized: true },
      max: 10,
      idleTimeoutMillis: 5000,
    });
  }

  return pool;
}

export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
