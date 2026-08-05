import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const token = process.env.MOTHERDUCK_TOKEN?.trim();

if (!token) {
  process.exit(0);
}

const tokenFile = process.env.MOTHERDUCK_TOKEN_FILE
  ? path.isAbsolute(process.env.MOTHERDUCK_TOKEN_FILE)
    ? process.env.MOTHERDUCK_TOKEN_FILE
    : path.resolve(appRoot, process.env.MOTHERDUCK_TOKEN_FILE)
  : path.join(appRoot, ".motherduck-token");

fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
console.log(`Wrote MotherDuck token to ${tokenFile}`);
