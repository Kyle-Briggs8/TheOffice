# The Office: Agent Sim

A pixel-art office sim that is a real multi-agent coding orchestrator. Each NPC
"employee" is a live Claude Code session (Claude Agent SDK). See `CLAUDE_1.md`
for the full design and build order.

**Build status: step 2 of 6** — server skeleton with one agent ("jim"), the
AgentManager, the status state machine, the mock event pipeline, and GitService
(branch + worktree lifecycle, merge with conflict auto-send-back). No WebSocket,
no game client yet.

## Layout

```
shared/   protocol types (ServerEvent / ClientCommand) — one source of truth
server/   Node 18+ / TypeScript backend
  src/agents/        AgentManager, AgentSession (state machine), runners
  src/git/           GitService (branch + worktree lifecycle, raw git via execa)
  src/personalities/ per-agent system prompts (jim.md)
client/   Phaser game — empty until step 4
office-hq/ runtime data dir (gitignored): project repo + worktrees/<agent>/
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

Assigns jim a sample task and drives the full review loop off the event stream:

```
idle → working → agent.activity ×5 → agent.message → ready_for_review
     → send back (revising) → ready_for_review again → merge → idle
```

Pass a custom task as arguments: `npm run demo -- "refactor the widget"`.
`MOCK_DELAY_MS` controls pacing (default 600). Mock mode never touches git.

All game/UI development happens in mock mode — this protects the Claude Pro
rate limits.

## Git lifecycle demo (real git, zero SDK calls)

```sh
npm run demo:git
```

Exercises GitService against the toy repo at `office-hq/project`: branch
`office/jim/<slug>` from main + worktree at `office-hq/worktrees/jim`, commit,
diffstat, clean merge — then a real merge conflict (detected, aborted, files
reported). The toy repo is its own git repo; GitService refuses to run if
`office-hq/project` would resolve to any outer repo.

## Run against the real Claude Agent SDK

Uses your local Claude Code login (subscription auth). No API keys are asked
for or stored.

```sh
npm run demo:real
```

(equivalently `MOCK_AGENTS=0`, e.g. PowerShell: `$env:MOCK_AGENTS="0"; npm run demo`)

Assigning a task creates branch `office/jim/<task-slug>` from main and a git
worktree at `office-hq/worktrees/jim` — the SDK session's cwd. On completion
the manager commits the branch, computes a real diffstat, and emits
`review.ready`. Merging runs `--no-ff` into main; a conflict auto-sends the
task back to the agent with the conflicted files (the player never resolves
conflicts). File edits inside the worktree are auto-approved; anything else
(Bash, paths outside the worktree) emits `agent.permission_request` and the
agent goes `blocked` until `AgentManager.respondPermission()` is called —
unanswered requests auto-deny after 2 minutes. With no UI yet, expect real-mode
runs to deny anything beyond file edits (including the `git rebase` a conflict
resolution needs). Real sessions are for integration testing only.

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

3. WS gateway + plain HTML debug page
4. Phaser client
5. Three agents + concurrency cap UX
6. Manager-office review panel
