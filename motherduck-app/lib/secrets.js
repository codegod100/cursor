import { fetchSecretFromOpenBao, isOpenBaoFetchConfigured } from "./openbao.js";

export { isOpenBaoFetchConfigured as isOpenBaoConfigured };

let motherduckToken = process.env.MOTHERDUCK_TOKEN ?? null;
let lastLoadResult = null;

function getInjectedSecretNames() {
  const raw =
    process.env.CLOUD_AGENT_INJECTED_SECRET_NAMES ??
    process.env.CLOUD_AGENT_ALL_SECRET_NAMES ??
    "";
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function getMotherDuckToken() {
  return motherduckToken;
}

export function isMotherDuckTokenConfigured() {
  return Boolean(motherduckToken);
}

export function getSecretDiagnostics() {
  const injectedSecretNames = getInjectedSecretNames();
  return {
    motherduckTokenPresent: Boolean(motherduckToken),
    injectedSecretNames,
    motherduckInjected: injectedSecretNames.includes("MOTHERDUCK_TOKEN"),
    openbaoTokenPresent: Boolean(process.env.OPENBAO_TOKEN),
    openbaoFetchConfigured: isOpenBaoFetchConfigured(),
    lastLoad: lastLoadResult,
  };
}

function buildConfigurationError() {
  const injectedSecretNames = getInjectedSecretNames();
  const hasOpenBaoToken = Boolean(process.env.OPENBAO_TOKEN);
  const motherduckInjected = injectedSecretNames.includes("MOTHERDUCK_TOKEN");

  if (motherduckInjected && !motherduckToken) {
    return "MOTHERDUCK_TOKEN is listed as injected but is not available in the process environment. Restart the Cloud Agent after adding the secret.";
  }

  if (hasOpenBaoToken && !isOpenBaoFetchConfigured()) {
    return (
      "MOTHERDUCK_TOKEN is not injected. OPENBAO_TOKEN is present, but Cursor Cloud Agents do not expose " +
      "a fetchable OpenBao API in the VM. Add MOTHERDUCK_TOKEN as a Runtime Secret in your Cursor environment " +
      "so it is injected directly, or set OPENBAO_ADDR if you are using a self-hosted OpenBao server."
    );
  }

  if (isOpenBaoFetchConfigured()) {
    return (
      "MOTHERDUCK_TOKEN is not set and could not be read from OpenBao. " +
      "Verify the secret exists at secret/data/MOTHERDUCK_TOKEN and that OPENBAO_TOKEN can read it."
    );
  }

  return (
    "MOTHERDUCK_TOKEN is not configured. Add it as a Runtime Secret in your Cursor environment " +
    "(https://cursor.com/dashboard/cloud-agents) or set it in .env for local development."
  );
}

export function getMotherDuckConfigurationError() {
  if (isMotherDuckTokenConfigured()) {
    return null;
  }
  return buildConfigurationError();
}

export async function loadSecrets() {
  if (motherduckToken) {
    lastLoadResult = { source: "environment", configured: true };
    return lastLoadResult;
  }

  if (!isOpenBaoFetchConfigured()) {
    lastLoadResult = {
      source: "none",
      configured: false,
      error: buildConfigurationError(),
    };
    return lastLoadResult;
  }

  try {
    motherduckToken = await fetchSecretFromOpenBao("MOTHERDUCK_TOKEN");
    process.env.MOTHERDUCK_TOKEN = motherduckToken;
    lastLoadResult = { source: "openbao", configured: true };
    return lastLoadResult;
  } catch (error) {
    lastLoadResult = {
      source: "openbao",
      configured: false,
      error: error.message,
    };
    return lastLoadResult;
  }
}
