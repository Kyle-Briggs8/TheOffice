# The Office: Agent Sim

A pixel-art office sim that is a real multi-agent coding orchestrator. Each NPC
"employee" is a live Claude Code session (Claude Agent SDK). See `CLAUDE_1.md`
for the full design and build order.

**Build status: step 1 of 6** — server skeleton with one agent ("jim"), the
AgentManager, the status state machine, and a mock event pipeline. No git
worktrees, no WebSocket, no game client yet.

## Layout

```
shared/   protocol types (ServerEvent / ClientCommand) — one source of truth
server/   Node 18+ / TypeScript backend
  src/agents/        AgentManager, AgentSession (state machine), runners
  src/personalities/ per-agent system prompts (jim.md)
client/   Phaser game — empty until step 4
office-hq/ runtime data dir (gitignored), created on demand in real mode
```

TypeScript strict mode, ESM, npm workspaces. Run with `tsx` (no build step).

## Setup

```sh
npm install
```

## Run the mock demo (default — zero SDK calls)

```sh
npm run demo
```

Assigns jim a sample task and logs the scripted event flow to the console:

```
idle → working → agent.activity ×5 → agent.message → ready_for_review (+ review.ready)
```

Pass a custom task as arguments: `npm run demo -- "refactor the widget"`.
`MOCK_DELAY_MS` controls pacing (default 600).

All game/UI development happens in mock mode — this protects the Claude Pro
rate limits.

## Run against the real Claude Agent SDK

Uses your local Claude Code login (subscription auth). No API keys are asked
for or stored.

```sh
npm run demo:real
```

(equivalently `MOCK_AGENTS=0`, e.g. PowerShell: `$env:MOCK_AGENTS="0"; npm run demo`)

The agent works inside the toy repo at `office-hq/project/` (created
automatically). File edits inside it are auto-approved; anything else (Bash,
paths outside the worktree) emits an `agent.permission_request` event and the
agent goes `blocked` until `AgentManager.respondPermission()` is called —
unanswered requests auto-deny after 2 minutes. With no UI yet, expect real-mode
runs to deny anything beyond file edits. Real sessions are for integration
testing only.

## Status state machine

```
idle → working → blocked → working
          ├────────────→ ready_for_review → revising → ready_for_review
          └→ idle              └→ idle (merge / kill)
```

Enforced in `server/src/agents/AgentSession.ts` — illegal transitions throw.

## Typecheck

```sh
npm run typecheck
```

## Next (do not skip ahead)

2. GitService: branch + worktree lifecycle
3. WS gateway + plain HTML debug page
4. Phaser client
5. Three agents + concurrency cap UX
6. Manager-office review panel
