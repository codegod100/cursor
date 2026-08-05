import { fetchSecretFromOpenBao } from "./openbao.js";

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

  if (!process.env.OPENBAO_TOKEN) {
    return { source: "none", configured: false };
  }

  motherduckToken = await fetchSecretFromOpenBao("MOTHERDUCK_TOKEN");
  process.env.MOTHERDUCK_TOKEN = motherduckToken;

  return { source: "openbao", configured: true };
}
