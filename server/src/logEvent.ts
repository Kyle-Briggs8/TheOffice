import type { ServerEvent } from "@office/shared";

const ICONS: Record<string, string> = {
  idle: "☕",
  working: "⌨️",
  blocked: "❗",
  ready_for_review: "📋",
  revising: "🔁",
  on_break: "💤",
};

/** Console renderer for the event stream — used by the demo and the server. */
export function logEvent(event: ServerEvent): void {
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
}
