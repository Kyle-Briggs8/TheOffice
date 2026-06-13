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
}

/**
 * One implementation per mode: MockAgentRunner (scripted, default) and
 * SdkAgentRunner (real Claude Agent SDK session, MOCK_AGENTS=0).
 */
export interface AgentRunner {
  /** Run a task to completion (status ends at ready_for_review or idle on failure). */
  assignTask(task: AssignedTask): Promise<void>;
  /** Inject a user chat message into the agent's live session. */
  sendChat(text: string): Promise<void>;
  /** Resolve a pending permission request. Returns false if the id is unknown. */
  respondPermission(requestId: string, approve: boolean): boolean;
  /** Tear down any live session. */
  dispose(): void;
}
