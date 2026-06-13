import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentStatus, ClientCommand, ServerEvent } from "@office/shared";
import type { ServerConfig } from "../config.js";
import { GitService, slugify } from "../git/GitService.js";
import { AgentSession, type AssignedTask } from "./AgentSession.js";
import type { AgentRunner, RunnerContext } from "./runner.js";
import { MockAgentRunner } from "./MockAgentRunner.js";
import { SdkAgentRunner } from "./SdkAgentRunner.js";

const personalitiesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "personalities",
);

interface ManagedAgent {
  session: AgentSession;
  runner: AgentRunner;
}

/**
 * Owns every AgentSession + its runner and is the single source of the
 * ServerEvent stream ("event"). The WS gateway (step 3) subscribes here;
 * for steps 1–2 the console does.
 *
 * Git lifecycle (real mode only — mock mode never touches git):
 *   assign  → branch office/<agent>/<slug> from main + worktree, SDK cwd = worktree
 *   done    → commit on branch, diffstat vs main, ready_for_review
 *   merge   → --no-ff into main; conflicts auto-send-back to the AGENT
 *   kill    → remove worktree + branch
 */
export class AgentManager extends EventEmitter {
  private agents = new Map<string, ManagedAgent>();
  private taskQueue: Array<{ agent: string; task: AssignedTask }> = [];
  private taskCounter = 0;
  private readonly git: GitService | null;

  constructor(private readonly config: ServerConfig) {
    super();
    this.git = config.mockAgents
      ? null
      : new GitService(config.projectDir, path.join(config.officeHqDir, "worktrees"));
  }

  async addAgent(name: string): Promise<void> {
    if (this.agents.has(name)) throw new Error(`agent "${name}" already exists`);
    const personality = await loadPersonality(name);
    const session = new AgentSession(name, personality);
    const ctx = this.makeContext(session);
    const runner: AgentRunner = this.config.mockAgents
      ? new MockAgentRunner(ctx, this.config.mockDelayMs)
      : new SdkAgentRunner(ctx, {
          cwd: this.config.projectDir,
          personality,
          permissionTimeoutMs: this.config.permissionTimeoutMs,
        });
    this.agents.set(name, { session, runner });
    this.emitEvent({ type: "agent.status", agent: name, status: session.status });
  }

  /** Single entry point for everything the client can send (WS gateway, step 3). */
  handleCommand(command: ClientCommand): void {
    switch (command.type) {
      case "task.assign":
        this.assignTask(command.agent, command.prompt);
        break;
      case "chat.send":
        void this.get(command.agent).runner.sendChat(command.text);
        break;
      case "permission.respond":
        this.respondPermission(command.requestId, command.approve);
        break;
      case "review.merge":
        void this.merge(command.taskId).catch(logCommandError(command.type));
        break;
      case "review.send_back":
        void this.sendBack(command.taskId, command.feedback).catch(logCommandError(command.type));
        break;
      case "review.kill":
        void this.kill(command.taskId).catch(logCommandError(command.type));
        break;
    }
  }

  assignTask(agentName: string, prompt: string): string {
    const { session } = this.get(agentName);
    if (session.task) {
      throw new Error(`agent "${agentName}" already has task ${session.task.taskId}`);
    }
    const taskId = `task-${++this.taskCounter}`;
    const task: AssignedTask = { taskId, prompt };
    session.task = task;

    if (this.workingCount() >= this.config.maxWorking) {
      // Concurrency cap: queue as 💤 "on break" — Pro limits are shared.
      this.taskQueue.push({ agent: agentName, task });
      this.emitEvent({ type: "task.update", taskId, status: "queued" });
    } else {
      this.startTask(agentName, task);
    }
    return taskId;
  }

  respondPermission(requestId: string, approve: boolean): void {
    for (const { runner } of this.agents.values()) {
      if (runner.respondPermission(requestId, approve)) return;
    }
    console.warn(`permission.respond: unknown requestId ${requestId}`);
  }

  /** Merge the task's branch into main. Conflicts auto-send-back to the agent. */
  async merge(taskId: string): Promise<void> {
    const { session, runner } = this.getByTask(taskId);
    if (session.status !== "ready_for_review") {
      console.warn(`review.merge: ${taskId} is not ready_for_review (${session.status})`);
      return;
    }
    if (this.git && session.branch) {
      const result = await this.git.merge(session.branch);
      if (!result.ok) {
        // Merge conflict → auto send-back with context; the AGENT resolves it.
        this.setStatus(session, "revising");
        this.emitEvent({ type: "task.update", taskId, status: "revising" });
        const files = result.conflictFiles.length > 0 ? result.conflictFiles.join(", ") : "(unknown)";
        await runner.sendChat(
          `Merging your branch ${session.branch} into main failed with conflicts in: ${files}. ` +
            `In your worktree, rebase onto main (git rebase main), resolve the conflicts, ` +
            `commit, and report back when the branch merges cleanly.`,
        );
        return;
      }
      await this.git.removeTaskWorktree(session.name, session.branch, { force: false });
    }
    runner.endTask();
    this.emitEvent({ type: "task.update", taskId, status: "merged" });
    this.clearTask(session);
  }

  /** Feedback goes straight into the agent's live session; same branch. */
  async sendBack(taskId: string, feedback?: string): Promise<void> {
    const { session, runner } = this.getByTask(taskId);
    if (session.status !== "ready_for_review") {
      console.warn(`review.send_back: ${taskId} is not ready_for_review (${session.status})`);
      return;
    }
    this.setStatus(session, "revising");
    this.emitEvent({ type: "task.update", taskId, status: "revising" });
    await runner.sendChat(feedback ?? "Please revise — this isn't quite it yet.");
  }

  /** Drop the task: end the session, remove worktree + branch. */
  async kill(taskId: string): Promise<void> {
    const { session, runner } = this.getByTask(taskId);
    runner.endTask();
    if (this.git && session.branch) {
      await this.git.removeTaskWorktree(session.name, session.branch, { force: true });
    }
    this.emitEvent({ type: "task.update", taskId, status: "killed" });
    this.clearTask(session);
  }

  dispose(): void {
    for (const { runner } of this.agents.values()) runner.dispose();
  }

  // -------------------------------------------------------------------------

  private startTask(agentName: string, task: AssignedTask): void {
    void (async () => {
      const { session, runner } = this.get(agentName);
      if (this.git) {
        await this.git.ensureProjectRepo();
        const slug = `${task.taskId}-${slugify(task.prompt)}`;
        const { branch, worktreePath } = await this.git.createTaskWorktree(agentName, slug);
        session.branch = branch;
        session.worktreePath = worktreePath;
        task.worktreePath = worktreePath;
      }
      await runner.assignTask(task);
    })().catch((err: unknown) => {
      console.error(`[${agentName}] task ${task.taskId} failed:`, err);
    });
  }

  /** Runner says the work is done: commit + diffstat (real), then review events. */
  private async completeTask(session: AgentSession, summary: string): Promise<void> {
    const task = session.task;
    if (!task) return;

    let diffStat = "+18 -2 across 2 files (mock)";
    if (this.git && session.branch && session.worktreePath) {
      await this.git.commitAll(
        session.worktreePath,
        `feat: ${task.prompt.slice(0, 60)} (${session.name})`,
      );
      diffStat = await this.git.diffStat(session.branch);
    }

    this.setStatus(session, "ready_for_review");
    this.emitEvent({ type: "task.update", taskId: task.taskId, status: "ready_for_review" });
    // review.ready last: listeners react to it (send back / merge), and those
    // reactions must not interleave with this task's own completion events.
    this.emitEvent({
      type: "review.ready",
      agent: session.name,
      taskId: task.taskId,
      summary,
      diffStat,
    });
  }

  private clearTask(session: AgentSession): void {
    session.task = null;
    session.branch = null;
    session.worktreePath = null;
    if (session.status !== "idle") this.setStatus(session, "idle");
  }

  private drainQueue(): void {
    while (this.taskQueue.length > 0 && this.workingCount() < this.config.maxWorking) {
      const next = this.taskQueue.shift();
      if (next) this.startTask(next.agent, next.task);
    }
  }

  private workingCount(): number {
    let count = 0;
    for (const { session } of this.agents.values()) {
      if (session.status === "working" || session.status === "revising") count++;
    }
    return count;
  }

  private setStatus(session: AgentSession, status: AgentStatus): void {
    if (status === session.status) return;
    session.transition(status); // throws on illegal jumps
    this.emitEvent({ type: "agent.status", agent: session.name, status });
    if (status !== "working" && status !== "revising") this.drainQueue();
  }

  private makeContext(session: AgentSession): RunnerContext {
    return {
      agentName: session.name,
      emit: (event) => this.emitEvent(event),
      getStatus: () => session.status,
      setStatus: (status) => this.setStatus(session, status),
      completeTask: (summary) => this.completeTask(session, summary),
    };
  }

  private emitEvent(event: ServerEvent): void {
    this.emit("event", event);
  }

  private get(name: string): ManagedAgent {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`unknown agent "${name}"`);
    return agent;
  }

  private getByTask(taskId: string): ManagedAgent {
    for (const managed of this.agents.values()) {
      if (managed.session.task?.taskId === taskId) return managed;
    }
    throw new Error(`no agent owns task "${taskId}"`);
  }
}

function logCommandError(commandType: string) {
  return (err: unknown) => console.error(`${commandType} failed:`, err);
}

async function loadPersonality(name: string): Promise<string> {
  try {
    return await readFile(path.join(personalitiesDir, `${name}.md`), "utf8");
  } catch {
    throw new Error(`no personality file for "${name}" in server/src/personalities/`);
  }
}
