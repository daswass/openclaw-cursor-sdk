import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load KEY=VALUE pairs from a .env file if present. Does not override existing env vars.
 */
export function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

/** Load `.env` from the current working directory when running dev scripts. */
export function loadLocalEnv() {
  loadEnvFile(path.join(process.cwd(), ".env"));
}
