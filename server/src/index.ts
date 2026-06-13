/**
 * Demo entry: one agent ("jim"), one task, structured events logged to the
 * console. Mock mode (default) proves the full event flow with zero SDK calls;
 * --real / MOCK_AGENTS=0 runs an actual Claude Agent SDK session in a git
 * worktree. After the first review.ready the demo sends the task back once
 * (revising loop), then merges — exercising the step 2 review commands.
 */
import type { ServerEvent } from "@office/shared";
import { loadConfig } from "./config.js";
import { AgentManager } from "./agents/AgentManager.js";

const ICONS: Record<string, string> = {
  idle: "☕",
  working: "⌨️",
  blocked: "❗",
  ready_for_review: "📋",
  revising: "🔁",
};

function logEvent(event: ServerEvent): void {
  const time = new Date().toISOString().slice(11, 19);
  let line: string;
  switch (event.type) {
    case "agent.status":
      line = `${event.agent} is now ${event.status} ${ICONS[event.status] ?? ""}`;
      break;
    case "agent.activity":
      line = `${event.agent} [${event.icon}] ${event.text}`;
      break;
    case "agent.message":
      line = `${event.agent} says: ${event.text}`;
      break;
    case "agent.permission_request":
      line = `${event.agent} wants to use ${event.tool} (${event.requestId}): ${event.detail}`;
      break;
    case "review.ready":
      line = `${event.agent} ready for review — ${event.taskId}: ${event.summary} [${event.diffStat}]`;
      break;
    case "task.update":
      line = `${event.taskId} → ${event.status}`;
      break;
  }
  console.log(`${time} ${event.type.padEnd(26)} ${line}`);
  console.log(`         raw: ${JSON.stringify(event)}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const prompt =
    process.argv.slice(2).filter((a) => a !== "--real").join(" ") ||
    "Add a hello() function in src/hello.ts that returns the string 'world', and a tiny test for it.";

  console.log(`mode: ${config.mockAgents ? "MOCK (no SDK calls)" : "REAL (Claude Agent SDK)"}`);
  console.log(`task: ${prompt}\n`);

  const manager = new AgentManager(config);
  manager.on("event", logEvent);

  await manager.addAgent("jim");
  const taskId = manager.assignTask("jim", prompt);

  // Drive the review loop off the event stream: first review.ready → send
  // back once; second review.ready → merge; merged → done.
  let reviewCount = 0;
  const done = new Promise<void>((resolve) => {
    manager.on("event", (event: ServerEvent) => {
      if (event.type === "review.ready" && event.taskId === taskId) {
        reviewCount++;
        if (reviewCount === 1) {
          console.log("\n>> sending back for revision…\n");
          manager.handleCommand({
            type: "review.send_back",
            taskId,
            feedback: "Looks good, but rename hello() to greet() and add a doc comment.",
          });
        } else {
          console.log("\n>> merging…\n");
          manager.handleCommand({ type: "review.merge", taskId });
        }
      }
      if (event.type === "task.update" && event.taskId === taskId && event.status === "merged") {
        resolve();
      }
    });
  });

  await done;
  console.log("\ntask merged, jim is back to idle — demo complete.");
  manager.dispose();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
