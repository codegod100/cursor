import { fetchSecretFromOpenBao, isOpenBaoConfigured } from "./openbao.js";

export { isOpenBaoConfigured };

let motherduckToken = process.env.MOTHERDUCK_TOKEN ?? null;

export function getMotherDuckToken() {
  return motherduckToken;
}

export function isMotherDuckTokenConfigured() {
  return Boolean(motherduckToken);
}

export async function loadSecrets() {
  if (motherduckToken) {
    return { source: "environment", configured: true };
  }

  if (!isOpenBaoConfigured()) {
    return { source: "none", configured: false };
  }

  try {
    motherduckToken = await fetchSecretFromOpenBao("MOTHERDUCK_TOKEN");
    process.env.MOTHERDUCK_TOKEN = motherduckToken;
    return { source: "openbao", configured: true };
  } catch (error) {
    return { source: "openbao", configured: false, error: error.message };
  }
}
