import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMotherDuckConfigured, withClient } from "./lib/motherduck.js";
import {
  getMotherDuckConfigurationError,
  getSecretDiagnostics,
  loadSecrets,
} from "./lib/secrets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  const diagnostics = getSecretDiagnostics();
  res.json({
    status: "ok",
    database: process.env.MOTHERDUCK_DB ?? "sample_data",
    motherduckConfigured: isMotherDuckConfigured(),
    ...diagnostics,
  });
});

function requireMotherDuck(_req, res, next) {
  if (!isMotherDuckConfigured()) {
    return res.status(503).json({
      error: getMotherDuckConfigurationError(),
    });
  }
  next();
}

app.get("/api/trips", requireMotherDuck, async (_req, res) => {
  try {
    const rows = await withClient(async (client) => {
      const result = await client.query(`
        SELECT
          tpep_pickup_datetime,
          passenger_count,
          trip_distance,
          fare_amount,
          payment_type
        FROM nyc.taxi
        ORDER BY tpep_pickup_datetime DESC
        LIMIT 20
      `);
      return result.rows;
    });
    res.json({ trips: rows });
  } catch (error) {
    console.error("Failed to fetch trips:", error);
    res.status(500).json({ error: "Failed to query MotherDuck" });
  }
});

app.get("/api/stats", requireMotherDuck, async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end || !DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) {
    return res.status(400).json({
      error: "Invalid date range. Use start and end query params in YYYY-MM-DD format.",
    });
  }

  try {
    const stats = await withClient(async (client) => {
      const result = await client.query(
        `SELECT
          sum(passenger_count)::INTEGER AS total_passengers,
          round(sum(fare_amount), 2) AS total_fare,
          count(*)::INTEGER AS trip_count
        FROM nyc.taxi
        WHERE tpep_pickup_datetime >= $1
          AND tpep_pickup_datetime < $2`,
        [`${start} 00:00:00`, `${end} 00:00:00`]
      );
      return result.rows[0];
    });

    res.json({ start, end, ...stats });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    res.status(500).json({ error: "Failed to query MotherDuck" });
  }
});

async function start() {
  try {
    const secretStatus = await loadSecrets();
    if (secretStatus.error) {
      console.warn(`Secret load: ${secretStatus.error}`);
      console.warn(
        "Create motherduck-app/.motherduck-token with your MotherDuck token, " +
          "or add MOTHERDUCK_TOKEN as a Cursor Runtime Secret and restart the agent."
      );
    } else {
      console.log(`Secrets loaded from ${secretStatus.source}`);
    }
  } catch (error) {
    console.warn("Failed to load secrets:", error.message);
  }

  app.listen(port, () => {
    console.log(`MotherDuck app listening on http://localhost:${port}`);
  });
}

start();
