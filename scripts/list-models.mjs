#!/usr/bin/env node
import { Cursor } from "@cursor/sdk";
import { loadLocalEnv } from "./load-env.mjs";

loadLocalEnv();

const filter = process.argv[2] ?? "composer";
const apiKey = process.env.CURSOR_API_KEY?.trim();
if (!apiKey) {
  console.error("CURSOR_API_KEY is not set");
  process.exit(1);
}

const models = await Cursor.models.list({ apiKey });
for (const model of models) {
  if (filter && !model.id.includes(filter)) {
    continue;
  }
  console.log(JSON.stringify(model, null, 2));
}
