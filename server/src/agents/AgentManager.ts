import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentStatus, ClientCommand, ServerEvent } from "@office/shared";
import type { ServerConfig } from "../config.js";
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
 * for step 1 the console does.
 */
export class AgentManager extends EventEmitter {
  private agents = new Map<string, ManagedAgent>();
  private taskQueue: Array<{ agent: string; task: AssignedTask }> = [];
  private taskCounter = 0;

  constructor(private readonly config: ServerConfig) {
    super();
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
      case "review.send_back":
      case "review.kill":
        // Review flow needs GitService — lands in steps 2 and 6.
        console.warn(`command ${command.type} not implemented until step 2/6`);
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

  dispose(): void {
    for (const { runner } of this.agents.values()) runner.dispose();
  }

  // -------------------------------------------------------------------------

  private startTask(agentName: string, task: AssignedTask): void {
    const { runner } = this.get(agentName);
    void runner.assignTask(task).catch((err: unknown) => {
      console.error(`[${agentName}] task ${task.taskId} failed:`, err);
    });
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

  private makeContext(session: AgentSession): RunnerContext {
    return {
      agentName: session.name,
      emit: (event) => this.emitEvent(event),
      getStatus: () => session.status,
      setStatus: (status: AgentStatus) => {
        if (status === session.status) return;
        session.transition(status); // throws on illegal jumps
        this.emitEvent({ type: "agent.status", agent: session.name, status });
        if (status !== "working" && status !== "revising") this.drainQueue();
      },
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
}

async function loadPersonality(name: string): Promise<string> {
  try {
    return await readFile(path.join(personalitiesDir, `${name}.md`), "utf8");
  } catch {
    throw new Error(`no personality file for "${name}" in server/src/personalities/`);
  }
}
