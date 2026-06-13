/**
 * Step 3 proof: a headless WS client that does exactly what the debug page
 * does — connect, receive the snapshot, assign a task, send it back once,
 * merge — all over ws://localhost:3001 against a running server (mock mode).
 */
import WebSocket from "ws";
import type { ClientCommand, ServerEvent } from "@office/shared";

const url = process.env.WS_URL ?? "ws://localhost:3001";
const ws = new WebSocket(url);

const send = (command: ClientCommand) => ws.send(JSON.stringify(command));
let reviewCount = 0;
let myTaskId: string | null = null;

const timeout = setTimeout(() => {
  console.error("smoke: timed out waiting for the merged event");
  process.exit(1);
}, 60_000);

ws.on("open", () => {
  console.log(`smoke: connected to ${url}`);
  send({ type: "task.assign", agent: "jim", prompt: "Smoke-test task over the wire" });
});

ws.on("message", (data) => {
  const event = JSON.parse(String(data)) as ServerEvent;
  console.log(`smoke: << ${JSON.stringify(event)}`);

  if (event.type === "task.update" && myTaskId === null && event.status === "in_progress") {
    myTaskId = event.taskId; // first task to start after our assign is ours
  }
  if (event.type === "agent.permission_request") {
    console.log("smoke: >> permission.respond (approve)");
    send({ type: "permission.respond", requestId: event.requestId, approve: true });
  }
  if (event.type === "review.ready" && event.taskId === myTaskId) {
    reviewCount++;
    if (reviewCount === 1) {
      console.log("smoke: >> review.send_back");
      send({ type: "review.send_back", taskId: event.taskId, feedback: "tighten it up" });
    } else {
      console.log("smoke: >> review.merge");
      send({ type: "review.merge", taskId: event.taskId });
    }
  }
  if (event.type === "task.update" && event.taskId === myTaskId && event.status === "merged") {
    clearTimeout(timeout);
    console.log("smoke: task merged over the wire — gateway works. ✔");
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => {
  console.error(`smoke: ${err.message} (is the server running? npm run start)`);
  process.exit(1);
});
