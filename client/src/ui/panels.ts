import type { Connection } from "../net/connection.js";
import type { OfficeState } from "../state/officeState.js";

const ICONS: Record<string, string> = { edit: "✏️", run: "▶️", read: "📖", test: "🧪" };

/**
 * DOM overlays for proximity tiers 2 and 3:
 *  - activity panel (read-only feed) when near a desk
 *  - chat panel on E: one input that assigns tasks (agent idle), chats
 *    (agent busy), and answers permission prompts. One mechanic, no special cases.
 */
export class Panels {
  private chatAgent: string | null = null;
  private activityAgent: string | null = null;
  /** Set while the chat input has focus — the scene stops moving the player. */
  inputFocused = false;

  private readonly el = {
    conn: document.getElementById("conn") as HTMLSpanElement,
    hint: document.getElementById("hint") as HTMLDivElement,
    activity: document.getElementById("activity") as HTMLDivElement,
    activityTitle: document.getElementById("activityTitle") as HTMLHeadingElement,
    activityBody: document.getElementById("activityBody") as HTMLDivElement,
    chat: document.getElementById("chat") as HTMLDivElement,
    chatTitle: document.getElementById("chatTitle") as HTMLHeadingElement,
    chatLog: document.getElementById("chatLog") as HTMLDivElement,
    chatMode: document.getElementById("chatMode") as HTMLDivElement,
    chatInput: document.getElementById("chatInput") as HTMLInputElement,
    chatSend: document.getElementById("chatSend") as HTMLButtonElement,
  };

  constructor(
    private readonly state: OfficeState,
    private readonly conn: Connection,
  ) {
    state.onChange(() => this.render());
    conn.onStatus((connected) => {
      this.el.conn.textContent = connected ? "● connected" : "● disconnected";
      this.el.conn.className = connected ? "ok" : "bad";
    });

    this.el.chatSend.onclick = () => this.submit();
    this.el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
      e.stopPropagation(); // typing must not move the player
    });
    this.el.chatInput.addEventListener("focus", () => (this.inputFocused = true));
    this.el.chatInput.addEventListener("blur", () => (this.inputFocused = false));
  }

  setHint(text: string): void {
    this.el.hint.style.display = text ? "block" : "none";
    this.el.hint.textContent = text;
  }

  // -- tier 2: activity feed --------------------------------------------------

  showActivity(agentName: string): void {
    this.activityAgent = agentName;
    this.el.activity.style.display = "block";
    this.render();
  }

  hideActivity(): void {
    this.activityAgent = null;
    this.el.activity.style.display = "none";
  }

  // -- tier 3: chat -----------------------------------------------------------

  isChatOpen(): boolean {
    return this.chatAgent !== null;
  }

  openChat(agentName: string): void {
    this.chatAgent = agentName;
    this.el.chat.style.display = "block";
    this.render();
    this.el.chatInput.focus();
  }

  closeChat(): void {
    this.chatAgent = null;
    this.el.chat.style.display = "none";
    this.el.chatInput.blur();
  }

  // ---------------------------------------------------------------------------

  private submit(): void {
    const agentName = this.chatAgent;
    const text = this.el.chatInput.value.trim();
    if (!agentName || !text) return;
    const agent = this.state.agents.get(agentName);

    if (agent?.status === "idle") {
      this.conn.send({ type: "task.assign", agent: agentName, prompt: text });
      this.state.recordPlayerMessage(agentName, `(task) ${text}`);
    } else {
      this.conn.send({ type: "chat.send", agent: agentName, text });
      this.state.recordPlayerMessage(agentName, text);
    }
    this.el.chatInput.value = "";
  }

  private render(): void {
    if (this.activityAgent) {
      const agent = this.state.agents.get(this.activityAgent);
      this.el.activityTitle.textContent = `${this.activityAgent} — activity`;
      this.el.activityBody.innerHTML = "";
      const items = agent?.activities ?? [];
      if (items.length === 0) {
        this.el.activityBody.textContent = "(nothing yet)";
      }
      for (const item of items) {
        const row = document.createElement("div");
        row.textContent = `${ICONS[item.icon] ?? ""} ${item.text}`;
        this.el.activityBody.appendChild(row);
      }
      this.el.activityBody.scrollTop = this.el.activityBody.scrollHeight;
    }

    if (this.chatAgent) {
      const agent = this.state.agents.get(this.chatAgent);
      this.el.chatTitle.textContent = `${this.chatAgent} — ${agent?.status ?? "?"}`;
      this.el.chatMode.textContent =
        agent?.status === "idle"
          ? "jim is idle — your message becomes a task assignment"
          : "jim is busy — your message goes into his live session";

      this.el.chatLog.innerHTML = "";
      for (const entry of agent?.chat ?? []) {
        const row = document.createElement("div");
        row.className = entry.who;
        row.textContent =
          entry.who === "player" ? `you: ${entry.text}`
          : entry.who === "agent" ? `${this.chatAgent}: ${entry.text}`
          : `· ${entry.text}`;
        this.el.chatLog.appendChild(row);
      }
      for (const perm of agent?.permissions.values() ?? []) {
        const row = document.createElement("div");
        row.className = "perm";
        row.textContent = `❗ wants to use ${perm.tool}: ${perm.detail} `;
        const approve = document.createElement("button");
        approve.textContent = "Approve";
        approve.onclick = () => this.respondPermission(perm.requestId, true);
        const deny = document.createElement("button");
        deny.className = "warn";
        deny.textContent = "Deny";
        deny.onclick = () => this.respondPermission(perm.requestId, false);
        row.append(approve, deny);
        this.el.chatLog.appendChild(row);
      }
      this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
    }
  }

  private respondPermission(requestId: string, approve: boolean): void {
    if (!this.chatAgent) return;
    this.conn.send({ type: "permission.respond", requestId, approve });
    this.state.resolvePermission(this.chatAgent, requestId, approve);
  }
}
