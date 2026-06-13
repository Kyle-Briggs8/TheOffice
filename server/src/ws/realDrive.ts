/**
 * One-shot real-mode driver: assign a small task over the wire, auto-approve any
 * permission prompts, stream events, and stop at ready_for_review so the git
 * worktree is left intact for inspection. Events also reach the game client
 * (broadcast), so you can watch jim work in the browser at the same time.
 */
import WebSocket from "ws";
import type { ClientCommand, ServerEvent } from "@office/shared";

const url = process.env.WS_URL ?? "ws://localhost:3001";
const prompt =
  process.argv.slice(2).join(" ") ||
  "Create a file called greeting.txt containing exactly the word: hello";

const ws = new WebSocket(url);
const send = (c: ClientCommand) => ws.send(JSON.stringify(c));
let myTaskId: string | null = null;

const timeout = setTimeout(() => {
  console.error("realDrive: timed out (5 min) waiting for ready_for_review");
  process.exit(1);
}, 300_000);

ws.on("open", () => {
  console.log(`realDrive: connected to ${url}`);
  console.log(`realDrive: assigning → ${prompt}`);
  send({ type: "task.assign", agent: "jim", prompt });
});

ws.on("message", (data) => {
  const event = JSON.parse(String(data)) as ServerEvent;
  console.log(`realDrive: << ${JSON.stringify(event)}`);

  if (event.type === "task.update" && myTaskId === null && event.status === "in_progress") {
    myTaskId = event.taskId;
  }
  if (event.type === "agent.permission_request") {
    console.log(`realDrive: >> auto-approving ${event.tool}`);
    send({ type: "permission.respond", requestId: event.requestId, approve: true });
  }
  if (event.type === "review.ready" && event.taskId === myTaskId) {
    clearTimeout(timeout);
    console.log(`realDrive: ✔ ready for review — ${event.summary} [${event.diffStat}]`);
    console.log("realDrive: worktree left intact at office-hq/worktrees/jim");
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => {
  console.error(`realDrive: ${err.message} (is the real server running?)`);
  process.exit(1);
});
