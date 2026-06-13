/**
 * Step 3 entry: long-running server — AgentManager + the single WebSocket
 * gateway on ws://localhost:3001, with the debug page at http://localhost:3001/.
 * Mock mode by default; --real / MOCK_AGENTS=0 for live SDK sessions.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { AgentManager } from "./agents/AgentManager.js";
import { Gateway } from "./ws/Gateway.js";
import { logEvent } from "./logEvent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const manager = new AgentManager(config);
  manager.on("event", logEvent);

  for (const name of ["jim", "dwight", "pam"]) {
    await manager.addAgent(name);
  }

  const debugPage = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "static",
    "debug.html",
  );
  const gateway = new Gateway(manager, config.wsPort, debugPage);
  await gateway.start();

  console.log(`mode: ${config.mockAgents ? "MOCK (no SDK calls)" : "REAL (Claude Agent SDK)"}`);
  console.log(`ws:    ws://localhost:${config.wsPort}`);
  console.log(`debug: http://localhost:${config.wsPort}/`);

  const shutdown = () => {
    gateway.stop();
    manager.dispose();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
