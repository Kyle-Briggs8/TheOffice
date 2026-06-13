import type { ActivityIcon, AgentStatus, ServerEvent } from "@office/shared";

export interface ChatEntry {
  who: "player" | "agent" | "system";
  text: string;
}

export interface PendingPermission {
  requestId: string;
  tool: string;
  detail: string;
}

export interface AgentView {
  name: string;
  status: AgentStatus;
  activities: Array<{ text: string; icon: ActivityIcon }>;
  chat: ChatEntry[];
  permissions: Map<string, PendingPermission>;
}

export interface ReviewItem {
  taskId: string;
  agent: string;
  summary: string;
  diffStat: string;
}

const MAX_ACTIVITIES = 20;
const MAX_CHAT = 60;

/**
 * Client-side view of the office, built purely from the event stream.
 * All three proximity tiers render from this one store.
 */
export class OfficeState {
  readonly agents = new Map<string, AgentView>();
  /** Branches sitting at ready_for_review, keyed by taskId — the review queue. */
  readonly reviews = new Map<string, ReviewItem>();
  private listeners = new Set<() => void>();

  apply(event: ServerEvent): void {
    switch (event.type) {
      case "agent.status":
        this.agent(event.agent).status = event.status;
        break;
      case "agent.activity": {
        const agent = this.agent(event.agent);
        agent.activities.push({ text: event.text, icon: event.icon });
        if (agent.activities.length > MAX_ACTIVITIES) agent.activities.shift();
        break;
      }
      case "agent.message":
        this.pushChat(event.agent, { who: "agent", text: event.text });
        break;
      case "agent.permission_request": {
        const agent = this.agent(event.agent);
        agent.permissions.set(event.requestId, {
          requestId: event.requestId,
          tool: event.tool,
          detail: event.detail,
        });
        break;
      }
      case "review.ready":
        this.reviews.set(event.taskId, {
          taskId: event.taskId,
          agent: event.agent,
          summary: event.summary,
          diffStat: event.diffStat,
        });
        this.pushChat(event.agent, {
          who: "system",
          text: `ready for review — ${event.summary} [${event.diffStat}]`,
        });
        break;
      case "task.update":
        // Leaving ready_for_review (merged/killed/sent back/re-working) drops it
        // from the review queue. No agent on this envelope; key off taskId.
        if (event.status !== "ready_for_review") this.reviews.delete(event.taskId);
        break;
    }
    this.notify();
  }

  /** Player sent something (so the chat log shows both sides). */
  recordPlayerMessage(agentName: string, text: string): void {
    this.pushChat(agentName, { who: "player", text });
    this.notify();
  }

  resolvePermission(agentName: string, requestId: string, approve: boolean): void {
    const agent = this.agent(agentName);
    agent.permissions.delete(requestId);
    this.pushChat(agentName, {
      who: "system",
      text: approve ? "permission approved" : "permission denied",
    });
    this.notify();
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private agent(name: string): AgentView {
    let agent = this.agents.get(name);
    if (!agent) {
      agent = { name, status: "idle", activities: [], chat: [], permissions: new Map() };
      this.agents.set(name, agent);
    }
    return agent;
  }

  private pushChat(agentName: string, entry: ChatEntry): void {
    const agent = this.agent(agentName);
    agent.chat.push(entry);
    if (agent.chat.length > MAX_CHAT) agent.chat.shift();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
