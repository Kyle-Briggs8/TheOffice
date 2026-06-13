import type { AgentRunner, RunnerContext } from "./runner.js";
import type { AssignedTask } from "./AgentSession.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Scripted fake event sequence — zero SDK calls. This is the default mode and
 * where all game/UI development happens (protects the Claude Pro rate limits).
 *
 * Script per task: working → a few agent.activity events → agent.message →
 * ready_for_review (+ review.ready + task.update).
 */
export class MockAgentRunner implements AgentRunner {
  private disposed = false;

  constructor(
    private readonly ctx: RunnerContext,
    private readonly baseDelayMs: number,
  ) {}

  async assignTask(task: AssignedTask): Promise<void> {
    const agent = this.ctx.agentName;
    const d = this.baseDelayMs;

    this.ctx.setStatus("working");
    this.ctx.emit({ type: "task.update", taskId: task.taskId, status: "in_progress" });

    const activities = [
      { text: "Read README.md", icon: "read" },
      { text: "Read src/index.ts", icon: "read" },
      { text: "Edited src/index.ts", icon: "edit" },
      { text: "Created src/hello.ts", icon: "edit" },
      { text: "Ran npm test (3 passed)", icon: "test" },
    ] as const;

    for (const activity of activities) {
      await sleep(d);
      if (this.disposed) return;
      this.ctx.emit({ type: "agent.activity", agent, ...activity });
    }

    await sleep(d);
    if (this.disposed) return;
    this.ctx.emit({
      type: "agent.message",
      agent,
      text: `Done with "${task.prompt}". Tests pass, nothing is on fire, and I only spent half the time staging the office supplies in jello. Ready when you are.`,
    });

    await sleep(d);
    if (this.disposed) return;
    this.ctx.setStatus("ready_for_review");
    this.ctx.emit({
      type: "review.ready",
      agent,
      taskId: task.taskId,
      summary: `Mock implementation of: ${task.prompt}`,
      diffStat: "+18 -2 across 2 files (mock)",
    });
    this.ctx.emit({ type: "task.update", taskId: task.taskId, status: "ready_for_review" });
  }

  async sendChat(text: string): Promise<void> {
    await sleep(this.baseDelayMs);
    if (this.disposed) return;
    this.ctx.emit({
      type: "agent.message",
      agent: this.ctx.agentName,
      text: `(mock) Heard you on "${text}". Noted — pretending to act on it convincingly.`,
    });
  }

  respondPermission(): boolean {
    // The mock script never requests permissions.
    return false;
  }

  dispose(): void {
    this.disposed = true;
  }
}
