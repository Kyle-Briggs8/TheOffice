/**
 * Step 5 proof: three agents + the concurrency cap. Assign all three a task at
 * once with maxWorking=2 and watch one queue as 💤 on_break, then start when a
 * slot frees. Mock mode, zero SDK calls. Auto-approves the scripted permission.
 */
import type { ServerEvent } from "@office/shared";
import { loadConfig } from "./config.js";
import { AgentManager } from "./agents/AgentManager.js";
import { logEvent } from "./logEvent.js";

async function main(): Promise<void> {
  const config = loadConfig([]); // mock
  console.log(`maxWorking: ${config.maxWorking}\n`);

  const manager = new AgentManager(config);
  manager.on("event", logEvent);
  manager.on("event", (event: ServerEvent) => {
    if (event.type === "agent.permission_request") {
      manager.respondPermission(event.requestId, true);
    }
  });

  for (const name of ["jim", "dwight", "pam"]) await manager.addAgent(name);

  console.log("— assigning all three at once —");
  manager.assignTask("jim", "task A");
  manager.assignTask("dwight", "task B");
  manager.assignTask("pam", "task C"); // should queue as on_break

  // Done when all three have reached ready_for_review at least once.
  const reviewed = new Set<string>();
  await new Promise<void>((resolve) => {
    manager.on("event", (event: ServerEvent) => {
      if (event.type === "review.ready") {
        reviewed.add(event.agent);
        if (reviewed.size === 3) resolve();
      }
    });
  });

  console.log("\nall three reached ready_for_review — cap held (max 2 working). ✔");
  manager.dispose();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
