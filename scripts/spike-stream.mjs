#!/usr/bin/env node
/**
 * Standalone spike: verify Cursor SDK stream events (thinking, assistant, tool_call).
 *
 * Usage:
 *   export CURSOR_API_KEY=...
 *   npm run spike -- [--model composer-2.5] [--prompt "..."] [--cwd /path/to/workspace]
 */

import path from "node:path";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { loadLocalEnv } from "./load-env.mjs";

function parseArgs(argv) {
  const out = {
    model: "composer-2.5",
    prompt:
      "Before answering, reason step by step internally. What is 17*23? Reply with the number only.",
    cwd: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model") {
      out.model = argv[++i] ?? out.model;
    } else if (arg === "--prompt") {
      out.prompt = argv[++i] ?? out.prompt;
    } else if (arg === "--cwd") {
      out.cwd = argv[++i] ?? out.cwd;
    }
  }
  return out;
}

async function main() {
  loadLocalEnv();

  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    console.error("CURSOR_API_KEY is not set");
    process.exit(1);
  }

  console.log(`model=${args.model} cwd=${path.resolve(args.cwd)}`);
  console.log(`prompt=${JSON.stringify(args.prompt)}`);
  console.log("--- stream ---");

  try {
    await using agent = await Agent.create({
      apiKey,
      model: { id: args.model },
      local: { cwd: args.cwd },
    });

    const run = await agent.send(args.prompt);
    let thinkingChars = 0;
    let assistantChars = 0;

    for await (const event of run.stream()) {
      if (event.type === "thinking") {
        thinkingChars += event.text?.length ?? 0;
        process.stdout.write(`\n[thinking] ${event.text ?? ""}`);
      } else if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block?.type === "text" && block.text) {
            assistantChars += block.text.length;
            process.stdout.write(block.text);
          } else if (block?.type === "tool_use") {
            console.error(
              `\n[tool_use] ${block.name} id=${block.id}`,
            );
          }
        }
      } else if (event.type === "tool_call") {
        console.error(
          `\n[tool_call] ${event.name} ${event.status} id=${event.call_id}`,
        );
      } else if (event.type === "status") {
        console.error(
          `\n[status] ${event.status}${event.message ? `: ${event.message}` : ""}`,
        );
      }
    }

    const result = await run.wait();
    console.log("\n--- done ---");
    console.log(
      JSON.stringify({ status: result.status, thinkingChars, assistantChars }, null, 2),
    );
    const ok = result.status === "finished" || result.status === "completed";
    process.exit(ok ? 0 : 2);
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error(`CursorAgentError: ${err.message} retryable=${err.isRetryable}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
