#!/usr/bin/env node
/**
 * Print the model catalog that the plugin provider would expose (live when CURSOR_API_KEY is set).
 *
 * Usage:
 *   export CURSOR_API_KEY=...
 *   npm run refresh-models
 */

import { loadLocalEnv } from "./load-env.mjs";
import { listCursorSdkCatalogModels } from "../src/catalog.mjs";

loadLocalEnv();

const models = await listCursorSdkCatalogModels();
console.log(JSON.stringify({ provider: "cursor-sdk", count: models.length, models }, null, 2));
