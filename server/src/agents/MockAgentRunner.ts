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
      { text: "Ran npm test (3 passed)", icon: "test" },
    ] as const;

    for (const activity of activities) {
      await sleep(d);
      if (gen !== this.generation) return;
      this.ctx.emit({ type: "agent.activity", agent, ...activity });
    }

    await sleep(d);
    if (gen !== this.generation) return;
    this.ctx.emit({
      type: "agent.message",
      agent,
      text: `Done with "${task.prompt}". Tests pass, nothing is on fire, and I only spent half the time staging the office supplies in jello. Ready when you are.`,
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

  respondPermission(): boolean {
    // The mock script never requests permissions.
    return false;
  }

  endTask(): void {
    this.generation++;
  }

  dispose(): void {
    this.generation++;
  }
}
