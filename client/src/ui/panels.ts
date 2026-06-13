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
  private reviewOpen = false;
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
    perms: document.getElementById("perms") as HTMLDivElement,
    review: document.getElementById("review") as HTMLDivElement,
    reviewBody: document.getElementById("reviewBody") as HTMLDivElement,
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
      if (e.key === "Escape") this.closeChat();
      e.stopPropagation(); // typing must not move the player
    });
    // Fallback so Esc closes the chat even when the input isn't focused
    // (Phaser's own listener can miss it depending on focus).
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isChatOpen()) this.closeChat();
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

  // -- manager office: review queue -------------------------------------------

  showReview(): void {
    if (this.reviewOpen) return;
    this.reviewOpen = true;
    this.el.review.style.display = "block";
    this.render();
  }

  hideReview(): void {
    if (!this.reviewOpen) return;
    this.reviewOpen = false;
    this.el.review.style.display = "none";
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
    this.renderPermissions();
    if (this.reviewOpen) this.renderReview();

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
          ? `${this.chatAgent} is idle — your message becomes a task assignment`
          : agent?.status === "on_break"
            ? `${this.chatAgent} is on break — queued, waiting for a free working slot`
            : `${this.chatAgent} is busy — your message goes into their live session`;

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
      this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
    }
  }

  /** Manager-office panel: every branch at ready_for_review with merge/back/kill. */
  private renderReview(): void {
    this.el.reviewBody.innerHTML = "";
    const reviews = [...this.state.reviews.values()];
    if (reviews.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No branches waiting. Go assign someone a task.";
      this.el.reviewBody.appendChild(empty);
      return;
    }
    for (const review of reviews) {
      const item = document.createElement("div");
      item.className = "item";

      const who = document.createElement("div");
      who.className = "who";
      who.textContent = `${review.agent} · ${review.taskId}`;

      const summary = document.createElement("div");
      summary.className = "summary";
      summary.textContent = review.summary;

      const diff = document.createElement("div");
      diff.className = "diff";
      diff.textContent = review.diffStat;

      const merge = document.createElement("button");
      merge.className = "merge";
      merge.textContent = "Merge";
      merge.onclick = () => this.conn.send({ type: "review.merge", taskId: review.taskId });

      const back = document.createElement("button");
      back.className = "back";
      back.textContent = "Send back";
      back.onclick = () => {
        const feedback = window.prompt(`Feedback for ${review.agent}:`) ?? undefined;
        if (feedback !== undefined) {
          this.conn.send({ type: "review.send_back", taskId: review.taskId, feedback });
        }
      };

      const kill = document.createElement("button");
      kill.className = "kill";
      kill.textContent = "Kill";
      kill.onclick = () => {
        if (window.confirm(`Kill ${review.taskId}? This removes ${review.agent}'s branch and worktree.`)) {
          this.conn.send({ type: "review.kill", taskId: review.taskId });
        }
      };

      item.append(who, summary, diff, merge, back, kill);
      this.el.reviewBody.appendChild(item);
    }
  }

  /**
   * Always-visible across the whole screen: a blocked agent must be answerable
   * no matter where the player is standing (the ❗ bubble is the ambient cue;
   * this tray is where you act on it). Lists pending requests for every agent.
   */
  private renderPermissions(): void {
    this.el.perms.innerHTML = "";
    let any = false;
    for (const agent of this.state.agents.values()) {
      for (const perm of agent.permissions.values()) {
        any = true;
        const req = document.createElement("div");
        req.className = "req";

        const head = document.createElement("div");
        head.className = "head";
        head.textContent = `❗ ${agent.name} wants to use ${perm.tool}`;

        const detail = document.createElement("div");
        detail.className = "detail";
        detail.textContent = perm.detail;

        const approve = document.createElement("button");
        approve.className = "ok";
        approve.textContent = "Approve";
        approve.onclick = () => this.respondPermission(agent.name, perm.requestId, true);

        const deny = document.createElement("button");
        deny.className = "no";
        deny.textContent = "Deny";
        deny.onclick = () => this.respondPermission(agent.name, perm.requestId, false);

        req.append(head, detail, approve, deny);
        this.el.perms.appendChild(req);
      }
    }
    this.el.perms.style.display = any ? "block" : "none";
  }

  private respondPermission(agentName: string, requestId: string, approve: boolean): void {
    this.conn.send({ type: "permission.respond", requestId, approve });
    this.state.resolvePermission(agentName, requestId, approve);
  }
}
