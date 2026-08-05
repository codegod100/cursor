import "dotenv/config";
import { loadSecrets } from "../lib/secrets.js";

const status = await loadSecrets();
console.log(JSON.stringify(status, null, 2));

if (!status.configured) {
  process.exit(1);
}
