import "dotenv/config";
import { loadSecrets } from "../lib/secrets.js";

try {
  const status = await loadSecrets();
  console.log(JSON.stringify(status, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
