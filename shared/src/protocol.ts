/**
 * WebSocket protocol — the single event stream every UI tier renders from.
 * JSON envelopes exactly as specified in CLAUDE_1.md. Don't invent side channels.
 */

export const AGENT_STATUSES = [
  "idle",
  "working",
  "blocked",
  "ready_for_review",
  "revising",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type ActivityIcon = "edit" | "run" | "read" | "test";

export type TaskStatus =
  | "queued"
  | "in_progress"
  | "ready_for_review"
  | "revising"
  | "merged"
  | "killed";

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export interface AgentStatusEvent {
  type: "agent.status";
  agent: string;
  status: AgentStatus;
}

/** A rendered activity-feed line, e.g. "Edited src/auth.ts". */
export interface AgentActivityEvent {
  type: "agent.activity";
  agent: string;
  text: string;
  icon: ActivityIcon;
}

/** Assistant text for the chat panel. */
export interface AgentMessageEvent {
  type: "agent.message";
  agent: string;
  text: string;
}

export interface AgentPermissionRequestEvent {
  type: "agent.permission_request";
  agent: string;
  requestId: string;
  tool: string;
  detail: string;
}

export interface ReviewReadyEvent {
  type: "review.ready";
  agent: string;
  taskId: string;
  summary: string;
  diffStat: string;
}

export interface TaskUpdateEvent {
  type: "task.update";
  taskId: string;
  status: TaskStatus;
}

export type ServerEvent =
  | AgentStatusEvent
  | AgentActivityEvent
  | AgentMessageEvent
  | AgentPermissionRequestEvent
  | ReviewReadyEvent
  | TaskUpdateEvent;

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export interface TaskAssignCommand {
  type: "task.assign";
  agent: string;
  prompt: string;
}

export interface ChatSendCommand {
  type: "chat.send";
  agent: string;
  text: string;
}

export interface PermissionRespondCommand {
  type: "permission.respond";
  requestId: string;
  approve: boolean;
}

export interface ReviewMergeCommand {
  type: "review.merge";
  taskId: string;
  feedback?: string;
}

export interface ReviewSendBackCommand {
  type: "review.send_back";
  taskId: string;
  feedback?: string;
}

export interface ReviewKillCommand {
  type: "review.kill";
  taskId: string;
  feedback?: string;
}

export type ClientCommand =
  | TaskAssignCommand
  | ChatSendCommand
  | PermissionRespondCommand
  | ReviewMergeCommand
  | ReviewSendBackCommand
  | ReviewKillCommand;
