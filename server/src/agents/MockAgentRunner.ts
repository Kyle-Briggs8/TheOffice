import type { AgentRunner, RunnerContext } from "./runner.js";
import type { AssignedTask } from "./AgentSession.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Scripted fake event sequence — zero SDK calls. This is the default mode and
 * where all game/UI development happens (protects the Claude Pro rate limits).
 *
 * Script per task: working → a few agent.activity events → agent.message →
 * completeTask (manager emits ready_for_review + review.ready). Feedback after
 * a send-back triggers one revision pass so the review loop is testable too.
 */
export class MockAgentRunner implements AgentRunner {
  /** Bumped by endTask/dispose so an in-flight script stops emitting. */
  private generation = 0;
  private pendingPermissions = new Map<string, (approve: boolean) => void>();
  private permissionCounter = 0;

  constructor(
    private readonly ctx: RunnerContext,
    private readonly baseDelayMs: number,
  ) {}

  async assignTask(task: AssignedTask): Promise<void> {
    const gen = this.generation;
    const agent = this.ctx.agentName;
    const d = this.baseDelayMs;

    this.ctx.setStatus("working");
    this.ctx.emit({ type: "task.update", taskId: task.taskId, status: "in_progress" });

    const activities = [
      { text: "Read README.md", icon: "read" },
      { text: "Read src/index.ts", icon: "read" },
      { text: "Edited src/index.ts", icon: "edit" },
      { text: "Created src/hello.ts", icon: "edit" },
    ] as const;

    for (const activity of activities) {
      await sleep(d);
      if (gen !== this.generation) return;
      this.ctx.emit({ type: "agent.activity", agent, ...activity });
    }

    // Scripted permission request: jim goes ❗ blocked until the player
    // answers (or the timeout denies) — same round-trip as real mode.
    await sleep(d);
    if (gen !== this.generation) return;
    const approved = await this.requestPermission("Bash", '{"command":"npm test"}');
    if (gen !== this.generation) return;
    this.ctx.setStatus("working");
    this.ctx.emit({
      type: "agent.activity",
      agent,
      ...(approved
        ? { text: "Ran npm test (3 passed)", icon: "test" as const }
        : { text: "Skipped npm test (denied)", icon: "run" as const }),
    });

    await sleep(d);
    if (gen !== this.generation) return;
    this.ctx.emit({
      type: "agent.message",
      agent,
      text: approved
        ? `Done with "${task.prompt}". Tests pass, nothing is on fire, and I only spent half the time staging the office supplies in jello. Ready when you are.`
        : `Done with "${task.prompt}". Couldn't run the tests (request denied), so consider this artisanal, hand-verified code. Ready when you are.`,
    });

    await sleep(d);
    if (gen !== this.generation) return;
    await this.ctx.completeTask(`Mock implementation of: ${task.prompt}`);
  }

  async sendChat(text: string): Promise<void> {
    const gen = this.generation;
    const agent = this.ctx.agentName;

    await sleep(this.baseDelayMs);
    if (gen !== this.generation) return;

    if (this.ctx.getStatus() === "revising") {
      // Send-back (or merge-conflict) feedback: do one scripted revision pass.
      this.ctx.emit({
        type: "agent.message",
        agent,
        text: `(mock) Fair point on "${text}". On it.`,
      });
      await sleep(this.baseDelayMs);
      if (gen !== this.generation) return;
      this.ctx.emit({ type: "agent.activity", agent, text: "Edited src/hello.ts", icon: "edit" });
      await sleep(this.baseDelayMs);
      if (gen !== this.generation) return;
      await this.ctx.completeTask("Mock revision: addressed the feedback");
      return;
    }

    this.ctx.emit({
      type: "agent.message",
      agent,
      text: `(mock) Heard you on "${text}". Noted — pretending to act on it convincingly.`,
    });
  }

  respondPermission(requestId: string, approve: boolean): boolean {
    const resolve = this.pendingPermissions.get(requestId);
    if (!resolve) return false;
    this.pendingPermissions.delete(requestId);
    resolve(approve);
    return true;
  }

  endTask(): void {
    this.generation++;
    this.failPendingPermissions();
  }

  dispose(): void {
    this.generation++;
    this.failPendingPermissions();
  }

  private requestPermission(tool: string, detail: string): Promise<boolean> {
    const requestId = `mock-perm-${++this.permissionCounter}`;
    // Register the resolver BEFORE emitting — listeners may respond
    // synchronously during the emit (EventEmitter is synchronous).
    const decision = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingPermissions.delete(requestId)) resolve(false);
      }, 60_000);
      this.pendingPermissions.set(requestId, (approve) => {
        clearTimeout(timer);
        resolve(approve);
      });
    });
    this.ctx.setStatus("blocked");
    this.ctx.emit({
      type: "agent.permission_request",
      agent: this.ctx.agentName,
      requestId,
      tool,
      detail,
    });
    return decision;
  }

  private failPendingPermissions(): void {
    for (const [id, resolve] of this.pendingPermissions) {
      this.pendingPermissions.delete(id);
      resolve(false);
    }
  }
}
