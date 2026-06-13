import type { AgentStatus } from "@office/shared";

/**
 * Status state machine: idle → working → blocked → ready_for_review → revising → idle.
 * Every status change in the system goes through `transition` so an illegal
 * jump (e.g. idle → ready_for_review) fails loudly instead of corrupting UI state.
 */
const TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  idle: ["working", "on_break"],
  on_break: ["working", "idle"], // queued → starts when a slot frees, or cancelled
  working: ["blocked", "ready_for_review", "idle"],
  blocked: ["working", "idle"],
  ready_for_review: ["revising", "idle"],
  revising: ["blocked", "ready_for_review", "idle"],
};

export class InvalidTransitionError extends Error {
  constructor(agent: string, from: AgentStatus, to: AgentStatus) {
    super(`agent "${agent}": invalid status transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export interface AssignedTask {
  taskId: string;
  prompt: string;
  /** Set by the manager in real mode: the agent's git worktree (= SDK cwd). */
  worktreePath?: string;
}

export class AgentSession {
  readonly name: string;
  readonly personality: string;
  status: AgentStatus = "idle";
  task: AssignedTask | null = null;
  branch: string | null = null;
  worktreePath: string | null = null;

  constructor(name: string, personality: string) {
    this.name = name;
    this.personality = personality;
  }

  canTransition(to: AgentStatus): boolean {
    return TRANSITIONS[this.status].includes(to);
  }

  transition(to: AgentStatus): void {
    if (to === this.status) return;
    if (!this.canTransition(to)) {
      throw new InvalidTransitionError(this.name, this.status, to);
    }
    this.status = to;
  }
}
