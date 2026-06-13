import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  /** MOCK_AGENTS=1 (the default) — scripted events, zero SDK calls. */
  mockAgents: boolean;
  /** Max agents in `working` simultaneously; others queue ("on break"). */
  maxWorking: number;
  /** Runtime data dir for the target project repo (never this game's repo). */
  officeHqDir: string;
  /** Toy repo the agents work against until GitService lands in step 2. */
  projectDir: string;
  /** How long a permission request can sit unanswered before auto-deny. */
  permissionTimeoutMs: number;
  /** Port for the single WebSocket gateway (+ the HTTP debug page). */
  wsPort: number;
  /** Base delay between scripted mock events. */
  mockDelayMs: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

export function loadConfig(argv: string[] = process.argv.slice(2)): ServerConfig {
  // Mock mode is mandatory and the default. Real SDK sessions are opt-in via
  // MOCK_AGENTS=0 or --real (the flag avoids env-var syntax differences on Windows).
  const real = argv.includes("--real") || process.env.MOCK_AGENTS === "0";
  const officeHqDir = path.join(repoRoot, "office-hq");
  return {
    mockAgents: !real,
    maxWorking: Number(process.env.MAX_WORKING ?? 2),
    officeHqDir,
    projectDir: path.join(officeHqDir, "project"),
    permissionTimeoutMs: Number(process.env.PERMISSION_TIMEOUT_MS ?? 120_000),
    wsPort: Number(process.env.WS_PORT ?? 3001),
    mockDelayMs: Number(process.env.MOCK_DELAY_MS ?? 600),
  };
}
