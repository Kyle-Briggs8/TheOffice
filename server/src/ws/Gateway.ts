import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientCommand, ServerEvent } from "@office/shared";
import type { AgentManager } from "../agents/AgentManager.js";

const COMMAND_TYPES = new Set([
  "task.assign",
  "chat.send",
  "permission.respond",
  "review.merge",
  "review.send_back",
  "review.kill",
]);

/**
 * The single WebSocket the game speaks through (default ws://localhost:3001).
 * The same port also serves the plain HTML debug page over HTTP at "/".
 *
 * Server → client: every ServerEvent from the AgentManager, broadcast to all
 * sockets; new connections first get a snapshot replay (same envelopes).
 * Client → server: ClientCommand JSON, routed to AgentManager.handleCommand.
 */
export class Gateway {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly onEvent = (event: ServerEvent) => this.broadcast(event);

  constructor(
    private readonly manager: AgentManager,
    private readonly port: number,
    private readonly debugPagePath: string,
  ) {}

  start(): Promise<void> {
    this.http = createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        readFile(this.debugPagePath)
          .then((html) => {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(html);
          })
          .catch(() => {
            res.writeHead(500);
            res.end("debug page missing");
          });
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on("connection", (socket) => {
      for (const event of this.manager.snapshotEvents()) {
        socket.send(JSON.stringify(event));
      }
      socket.on("message", (data) => this.handleMessage(String(data)));
    });

    this.manager.on("event", this.onEvent);

    return new Promise((resolve) => {
      this.http?.listen(this.port, resolve);
    });
  }

  stop(): void {
    this.manager.off("event", this.onEvent);
    this.wss?.close();
    this.http?.close();
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`ws: ignoring non-JSON message: ${raw.slice(0, 120)}`);
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("type" in parsed) ||
      !COMMAND_TYPES.has(String((parsed as { type: unknown }).type))
    ) {
      console.warn(`ws: ignoring unknown command: ${raw.slice(0, 120)}`);
      return;
    }
    try {
      this.manager.handleCommand(parsed as ClientCommand);
    } catch (err) {
      console.warn(`ws: command failed:`, err instanceof Error ? err.message : err);
    }
  }

  private broadcast(event: ServerEvent): void {
    if (!this.wss) return;
    const data = JSON.stringify(event);
    for (const socket of this.wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }
}
