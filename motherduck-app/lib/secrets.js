import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchSecretFromOpenBao,
  getOpenBaoDiagnostics,
  isOpenBaoConfigured,
  isOpenBaoFetchConfigured,
} from "./openbao.js";

export { isOpenBaoConfigured };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const defaultTokenFile = path.join(appRoot, ".motherduck-token");

let motherduckToken = null;
let tokenFilePath = null;
let lastLoadResult = null;

function resolveTokenFilePath() {
  const configured = process.env.MOTHERDUCK_TOKEN_FILE;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(appRoot, configured);
  }
  return defaultTokenFile;
}

function readTokenFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const value = fs.readFileSync(filePath, "utf8").trim();
  return value.length > 0 ? value : null;
}

function writeTokenToFile(filePath, token) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, { mode: 0o600 });
}

export function getMotherDuckToken() {
  return motherduckToken;
}

export function isMotherDuckTokenConfigured() {
  return Boolean(motherduckToken);
}

export function getSecretDiagnostics() {
  return {
    motherduckTokenPresent: Boolean(motherduckToken),
    tokenFilePath,
    tokenFileExists: tokenFilePath ? fs.existsSync(tokenFilePath) : false,
    openbaoConfigured: isOpenBaoConfigured(),
    openbaoFetchConfigured: isOpenBaoFetchConfigured(),
    ...getOpenBaoDiagnostics(),
    lastLoad: lastLoadResult,
  };
}

function buildConfigurationError() {
  if (isOpenBaoConfigured() && !isOpenBaoFetchConfigured()) {
    return (
      "MOTHERDUCK_TOKEN is stored in OpenBao, but OPENBAO_ADDR is missing. " +
      "Add OPENBAO_ADDR as a Cursor secret or create motherduck-app/.openbao-addr with your OpenBao URL."
    );
  }

  if (isOpenBaoFetchConfigured()) {
    return (
      "MOTHERDUCK_TOKEN was not found in the environment, on disk, or in OpenBao. " +
      "Verify the secret exists at secret/data/MOTHERDUCK_TOKEN."
    );
  }

  return (
    `MotherDuck token not found. Put your token in ${tokenFilePath ?? defaultTokenFile}, ` +
    "set MOTHERDUCK_TOKEN, or configure OpenBao (OPENBAO_TOKEN + OPENBAO_ADDR)."
  );
}

export function getMotherDuckConfigurationError() {
  if (isMotherDuckTokenConfigured()) {
    return null;
  }
  return buildConfigurationError();
}

export async function loadSecrets() {
  tokenFilePath = resolveTokenFilePath();

  const fromEnv = process.env.MOTHERDUCK_TOKEN?.trim();
  if (fromEnv) {
    motherduckToken = fromEnv;
    lastLoadResult = { source: "environment", configured: true, tokenFilePath };
    return lastLoadResult;
  }

  const fromFile = readTokenFromFile(tokenFilePath);
  if (fromFile) {
    motherduckToken = fromFile;
    process.env.MOTHERDUCK_TOKEN = fromFile;
    lastLoadResult = { source: "file", configured: true, tokenFilePath };
    return lastLoadResult;
  }

  if (isOpenBaoConfigured()) {
    try {
      const fromOpenBao = await fetchSecretFromOpenBao("MOTHERDUCK_TOKEN");
      motherduckToken = fromOpenBao;
      process.env.MOTHERDUCK_TOKEN = fromOpenBao;
      writeTokenToFile(tokenFilePath, fromOpenBao);
      lastLoadResult = {
        source: "openbao",
        configured: true,
        tokenFilePath,
        writtenToDisk: true,
      };
      return lastLoadResult;
    } catch (error) {
      lastLoadResult = {
        source: "openbao",
        configured: false,
        tokenFilePath,
        error: error.message,
      };
      return lastLoadResult;
    }
  }

  lastLoadResult = {
    source: "none",
    configured: false,
    tokenFilePath,
    error: buildConfigurationError(),
  };
  return lastLoadResult;
}
