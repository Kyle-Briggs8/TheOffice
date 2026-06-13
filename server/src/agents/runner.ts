import type { AgentStatus, ServerEvent } from "@office/shared";
import type { AssignedTask } from "./AgentSession.js";

/**
 * What a runner gets from the AgentManager. Runners never touch the session
 * directly — status changes go through setStatus so the state machine is
 * enforced in one place, and every event funnels through emit.
 */
export interface RunnerContext {
  agentName: string;
  emit(event: ServerEvent): void;
  setStatus(status: AgentStatus): void;
  getStatus(): AgentStatus;
  /**
   * The agent considers the task done. The manager commits the worktree,
   * computes the diffstat (real mode), and emits review.ready + status.
   */
  completeTask(summary: string): Promise<void>;
}

/**
 * One implementation per mode: MockAgentRunner (scripted, default) and
 * SdkAgentRunner (real Claude Agent SDK session, MOCK_AGENTS=0).
 */
export interface AgentRunner {
  /** Start working a task (resolves when the runner has finished its part). */
  assignTask(task: AssignedTask): Promise<void>;
  /** Inject a user chat message into the agent's live session. */
  sendChat(text: string): Promise<void>;
  /** Resolve a pending permission request. Returns false if the id is unknown. */
  respondPermission(requestId: string, approve: boolean): boolean;
  /** End the current task's session (merge/kill) — the runner stays usable. */
  endTask(): void;
  /** Tear down everything; the runner is done for good. */
  dispose(): void;
}
