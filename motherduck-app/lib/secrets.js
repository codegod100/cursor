import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    lastLoad: lastLoadResult,
  };
}

export function getMotherDuckConfigurationError() {
  if (isMotherDuckTokenConfigured()) {
    return null;
  }

  return (
    `MotherDuck token not found. Put your token in ${tokenFilePath ?? defaultTokenFile} ` +
    "or set MOTHERDUCK_TOKEN in the environment."
  );
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

  lastLoadResult = {
    source: "none",
    configured: false,
    tokenFilePath,
    error: getMotherDuckConfigurationError(),
  };
  return lastLoadResult;
}
