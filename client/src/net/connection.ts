import type { ClientCommand, ServerEvent } from "@office/shared";

type EventListener = (event: ServerEvent) => void;
type StatusListener = (connected: boolean) => void;

/** The single WebSocket to the server, with dumb 2s auto-reconnect. */
export class Connection {
  private ws: WebSocket | null = null;
  private eventListeners = new Set<EventListener>();
  private statusListeners = new Set<StatusListener>();

  constructor(private readonly url: string) {}

  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this.notifyStatus(true);
    this.ws.onmessage = (msg) => {
      const event = JSON.parse(String(msg.data)) as ServerEvent;
      for (const listener of this.eventListeners) listener(event);
    };
    this.ws.onclose = () => {
      this.notifyStatus(false);
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    }
  }

  onEvent(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  onStatus(listener: StatusListener): void {
    this.statusListeners.add(listener);
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) listener(connected);
  }
}
