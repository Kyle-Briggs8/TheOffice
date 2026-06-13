import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { ActivityIcon } from "@office/shared";
import type { AgentRunner, RunnerContext } from "./runner.js";
import type { AssignedTask } from "./AgentSession.js";
import { PushStream } from "./PushStream.js";

export interface SdkRunnerOptions {
  /** Fallback cwd; in practice each task carries its own git worktree path. */
  cwd: string;
  /** Personality system prompt, appended to the claude_code preset. */
  personality: string;
  permissionTimeoutMs: number;
}

/** Tools that may run without asking as long as they stay read-only. */
const AUTO_ALLOW_TOOLS = new Set(["Read", "Glob", "Grep", "TodoWrite"]);
/** File-editing tools — auto-allowed only inside the agent's own worktree. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

interface PendingPermission {
  resolve(approve: boolean): void;
}

/**
 * Real Claude Agent SDK session (MOCK_AGENTS=0). Authenticates via the local
 * Claude Code login — no API keys are read or stored anywhere in this codebase.
 *
 * One streaming-input session per assigned task, with cwd locked to the task's
 * git worktree: the task prompt starts the session, chat.send (and send-back
 * feedback) pushes follow-up user messages into it, and each SDK result maps
 * to completeTask → ready_for_review.
 */
export class SdkAgentRunner implements AgentRunner {
  private input: PushStream<SDKUserMessage> | null = null;
  private activeQuery: Query | null = null;
  private activeCwd: string;
  private pendingPermissions = new Map<string, PendingPermission>();
  private disposed = false;

  constructor(
    private readonly ctx: RunnerContext,
    private readonly options: SdkRunnerOptions,
  ) {
    this.activeCwd = options.cwd;
  }

  async assignTask(task: AssignedTask): Promise<void> {
    if (this.disposed) throw new Error("runner disposed");
    this.endTask(); // defensive: clear any leftover session
    this.activeCwd = task.worktreePath ?? this.options.cwd;
    this.ctx.setStatus("working");
    this.ctx.emit({ type: "task.update", taskId: task.taskId, status: "in_progress" });

    this.input = new PushStream<SDKUserMessage>();
    this.pushUserText(task.prompt);

    this.activeQuery = query({
      prompt: this.input,
      options: {
        cwd: this.activeCwd,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: this.options.personality,
        },
        permissionMode: "default",
        canUseTool: (toolName, input) => this.decidePermission(toolName, input),
        // Don't inherit this machine's user/project Claude settings into agents.
        settingSources: [],
      },
    });

    await this.consume(this.activeQuery);
  }

  async sendChat(text: string): Promise<void> {
    if (!this.input || !this.activeQuery) {
      console.warn(`[${this.ctx.agentName}] chat ignored — no live session (assign a task first)`);
      return;
    }
    if (this.ctx.getStatus() === "ready_for_review") {
      this.ctx.setStatus("revising");
    }
    this.pushUserText(text);
  }

  respondPermission(requestId: string, approve: boolean): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    pending.resolve(approve);
    return true;
  }

  endTask(): void {
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve(false);
      this.pendingPermissions.delete(id);
    }
    this.input?.close();
    this.activeQuery?.close();
    this.input = null;
    this.activeQuery = null;
  }

  dispose(): void {
    this.disposed = true;
    this.endTask();
  }

  // -------------------------------------------------------------------------

  private pushUserText(text: string): void {
    this.input?.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    } as SDKUserMessage);
  }

  private async consume(q: Query): Promise<void> {
    const agent = this.ctx.agentName;
    try {
      for await (const message of q as AsyncIterable<SDKMessage>) {
        if (this.disposed || this.activeQuery !== q) return;
        this.handleMessage(message);
      }
    } catch (err) {
      // endTask/dispose closes the query mid-iteration — that's not an error.
      if (this.disposed || this.activeQuery !== q) return;
      this.ctx.emit({
        type: "agent.message",
        agent,
        text: `Session error: ${err instanceof Error ? err.message : String(err)}`,
      });
      if (this.ctx.getStatus() !== "idle") this.ctx.setStatus("idle");
    }
  }

  private handleMessage(message: SDKMessage): void {
    const agent = this.ctx.agentName;
    switch (message.type) {
      case "system":
        if ("subtype" in message && message.subtype === "init") {
          console.log(`[${agent}] sdk session started (${message.session_id})`);
        }
        break;
      case "assistant": {
        const content = message.message.content;
        const blocks = Array.isArray(content) ? content : [];
        for (const block of blocks) {
          if (block.type === "text" && block.text.trim().length > 0) {
            this.ctx.emit({ type: "agent.message", agent, text: block.text });
          } else if (block.type === "tool_use") {
            this.ctx.emit({
              type: "agent.activity",
              agent,
              ...describeToolUse(block.name, block.input as Record<string, unknown>, this.activeCwd),
            });
          }
        }
        break;
      }
      case "result": {
        if (message.subtype === "success") {
          void this.ctx
            .completeTask(message.result ?? "(no summary)")
            .catch((err: unknown) => console.error(`[${agent}] completeTask failed:`, err));
        } else {
          this.ctx.emit({
            type: "agent.message",
            agent,
            text: `Task ended without success (${message.subtype}).`,
          });
          this.ctx.setStatus("idle");
        }
        break;
      }
      default:
        // Other SDK message types (status, partial, hooks, …) aren't part of
        // the game protocol yet — keep them off the event stream.
        break;
    }
  }

  private async decidePermission(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> {
    if (AUTO_ALLOW_TOOLS.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    if (EDIT_TOOLS.has(toolName) && this.isInsideWorktree(input)) {
      return { behavior: "allow", updatedInput: input };
    }

    // Everything else (Bash, network, paths outside the worktree, …) goes to
    // the player. Never auto-approve Bash.
    const requestId = randomUUID();
    this.ctx.setStatus("blocked");
    this.ctx.emit({
      type: "agent.permission_request",
      agent: this.ctx.agentName,
      requestId,
      tool: toolName,
      detail: JSON.stringify(input).slice(0, 300),
    });

    const approved = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingPermissions.delete(requestId)) resolve(false);
      }, this.options.permissionTimeoutMs);
      this.pendingPermissions.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });

    if (!this.disposed && this.ctx.getStatus() === "blocked") {
      this.ctx.setStatus("working");
    }
    return approved
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "The office manager denied this request." };
  }

  private isInsideWorktree(input: Record<string, unknown>): boolean {
    const candidate = input["file_path"] ?? input["path"] ?? input["notebook_path"];
    if (typeof candidate !== "string") return false;
    const resolved = path.resolve(this.activeCwd, candidate);
    const root = path.resolve(this.activeCwd);
    return resolved === root || resolved.startsWith(root + path.sep);
  }
}

function describeToolUse(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): { text: string; icon: ActivityIcon } {
  const rel = (p: unknown): string =>
    typeof p === "string" ? path.relative(cwd, path.resolve(cwd, p)) || "." : "?";

  switch (name) {
    case "Read":
      return { text: `Read ${rel(input["file_path"])}`, icon: "read" };
    case "Glob":
    case "Grep":
      return { text: `Searched ${String(input["pattern"] ?? "")}`, icon: "read" };
    case "Edit":
    case "MultiEdit":
      return { text: `Edited ${rel(input["file_path"])}`, icon: "edit" };
    case "Write":
      return { text: `Wrote ${rel(input["file_path"])}`, icon: "edit" };
    case "NotebookEdit":
      return { text: `Edited ${rel(input["notebook_path"])}`, icon: "edit" };
    case "Bash": {
      const cmd = String(input["command"] ?? "").slice(0, 80);
      return { text: `Ran ${cmd}`, icon: /\btest\b/.test(cmd) ? "test" : "run" };
    }
    default:
      return { text: `Used ${name}`, icon: "run" };
  }
}
