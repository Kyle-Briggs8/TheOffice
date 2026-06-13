# The Office: Agent Sim (working title)

A pixel-art office sim (The Office–style archetypes, original characters) that is a real
multi-agent coding orchestrator. Each NPC "employee" is a live Claude Code session (via the
Claude Agent SDK). The player walks around the office, assigns tasks, helps stuck agents,
approves permissions, and acts as merge authority for the shared repo.

## Architecture

Two processes, one repo (monorepo):

- `server/` — Node 18+ / TypeScript backend
  - Runs Claude Agent SDK sessions (one per character), authenticated via the local
    Claude Code login (subscription auth, NOT an API key — never ask for or store keys).
  - Manages a target git repo with one worktree per agent.
  - Exposes a single WebSocket (default ws://localhost:3001) speaking the JSON protocol below.
- `client/` — Phaser 3 + TypeScript + Vite pixel game
  - Connects to the WS, renders office, player, desks, status bubbles, panels.
- `office-hq/` — runtime data dir (gitignored): the target project repo + `worktrees/<agent>/`.

## Core concepts

### Agents
Characters: jim, dwight, pam (start with jim only; others added in step 5).
Each agent = AgentSession: { name, personality system prompt, sdk session, status, task, branch, worktreePath }.
Status state machine: idle → working → blocked (permission request) → ready_for_review → revising → idle.
Personalities live in per-agent system prompt files under `server/src/personalities/`. Keep them
archetypes (the prankster, the overeager one, the artist), not literal NBC characters.

### Git / worktrees (v1 collaboration model)
- One real repo at `office-hq/project` (main branch).
- Assign task to agent → create branch `office/<agent>/<task-slug>` from main →
  `git worktree add office-hq/worktrees/<agent> <branch>` → SDK session cwd = that worktree.
- Agent finishes → commit on branch → status ready_for_review.
- Player reviews in "manager office" UI: Merge (into main), Send back (feedback message injected
  into the agent's session; agent revises on same branch), or Kill (remove worktree + branch).
- Merge conflict handling: merge fails → auto "send back" with conflict context; the AGENT
  rebases onto main and resolves. The player never resolves conflicts manually.

### Permissions
SDK permission mode: auto-allow file edits inside the agent's own worktree; everything else
(Bash, network, anything outside worktree) becomes a permission_request event → ❗ bubble →
player approves/denies in the chat panel. Never auto-approve Bash.

### Proximity = context depth (game UX)
1. Far: ambient status bubbles only (⌨️ working, ☕ idle, ❗ blocked, 📋 ready for review, 💤 rate-limited).
2. Near desk: side panel with rendered activity feed (recent tool events, todo list). Read-only.
3. Press E: chat panel = inject user messages into that agent's live session. Assigning tasks,
   helping, and answering permission prompts all happen here. One mechanic, no special cases.

## WebSocket protocol (JSON envelopes)

Server → client:
- { type: "agent.status",  agent, status }
- { type: "agent.activity", agent, text, icon }            // "Edited src/auth.ts", icon: edit|run|read|test
- { type: "agent.message",  agent, text }                   // assistant text for chat panel
- { type: "agent.permission_request", agent, requestId, tool, detail }
- { type: "review.ready",   agent, taskId, summary, diffStat }
- { type: "task.update",    taskId, status }

Client → server:
- { type: "task.assign", agent, prompt }
- { type: "chat.send",   agent, text }
- { type: "permission.respond", requestId, approve }
- { type: "review.merge" | "review.send_back" | "review.kill", taskId, feedback? }

All three UI tiers render from this one event stream. Don't invent side channels.

## Build order (do not skip ahead)

1. server skeleton: AgentManager with ONE agent, SDK session, events logged to console.
   Prove: assign a task against a toy repo, watch structured events flow.
2. GitService (use execa + raw git, or simple-git): branch + worktree lifecycle wired into step 1.
3. WS gateway + a plain HTML debug page that renders the raw event stream.
4. Phaser client: tilemap office (Tiled JSON), player movement, one desk, proximity tiers,
   chat panel over WS. Placeholder art is fine.
5. Multiply to 3 agents + personality prompts. Concurrency cap (see Constraints).
6. Manager-office review panel: list ready branches, show diff summary, merge/send-back/kill.

## Constraints & conventions

- TypeScript strict mode everywhere. ESM. Node 18+.
- MOCK MODE is mandatory: `MOCK_AGENTS=1` makes AgentManager emit scripted fake event
  sequences (work → edits → done) with zero SDK calls. All game/UI dev happens in mock mode;
  real sessions are for integration testing only. This protects the Claude Pro rate limits.
- Concurrency cap: max 2 agents in `working` simultaneously (config). Others queue as 💤
  ("on break"). Pro subscription limits are shared across all sessions.
- The target repo for agents is ALWAYS under office-hq/, never this game's own repo.
  Agents must never get a cwd outside their worktree.
- Keep client and server types shared via a `shared/` package (protocol types in one place).
- Pixel art: 16x16 tiles, Tiled JSON maps in client/assets/maps/, free CC0 tilesets in
  client/assets/tilesets/ (attribution file required).
- No HTML form tags in any UI; plain handlers.
- Commit style: conventional commits (feat:, fix:, chore:).

## Out of scope for v1 (do not build yet)

- Team meeting / multi-agent discussion feature
- API-key / bring-your-own-account support
- Electron packaging
- Shared single checkout (never; worktrees only)
