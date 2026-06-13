import Phaser from "phaser";
import type { AgentStatus } from "@office/shared";
import type { Connection } from "../net/connection.js";
import type { OfficeState } from "../state/officeState.js";
import type { Panels } from "../ui/panels.js";

const BUBBLES: Record<AgentStatus, string> = {
  idle: "☕",
  working: "⌨️",
  blocked: "❗",
  ready_for_review: "📋",
  revising: "🔁",
  on_break: "💤",
};

/** Proximity tiers (world px from a desk): far → near (panel) → chat (E). */
const NEAR_RADIUS = 84;
const CHAT_RADIUS = 52;

/** Desk layout: one per agent, with the seated-worker sprite to use. */
const DESKS: ReadonlyArray<{ name: string; x: number; y: number; worker: string }> = [
  { name: "jim", x: 384, y: 96, worker: "worker" },
  { name: "dwight", x: 96, y: 112, worker: "worker2" },
  { name: "pam", x: 96, y: 240, worker: "worker4" },
];

interface Deps {
  state: OfficeState;
  conn: Connection;
  panels: Panels;
}

interface DeskView {
  name: string;
  x: number;
  y: number;
  bubble: Phaser.GameObjects.Text;
}

export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private keys!: Record<"W" | "A" | "S" | "D" | "E", Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private desks: DeskView[] = [];
  /** Agent whose desk the player is currently within chat range of (or null). */
  private chatTarget: string | null = null;

  constructor(private readonly deps: Deps) {
    super("office");
  }

  preload(): void {
    this.load.tilemapTiledJSON("office", "maps/office.json");
    const sheet = { frameWidth: 64, frameHeight: 64 };
    this.load.spritesheet("julia-down", "sprites/julia-down.png", sheet);
    this.load.spritesheet("julia-left", "sprites/julia-left.png", sheet);
    this.load.spritesheet("julia-right", "sprites/julia-right.png", sheet);
    this.load.spritesheet("julia-up", "sprites/julia-up.png", sheet);
    for (const key of [
      "worker", "worker2", "worker4", "desk-pc", "plant",
      "water-cooler", "coffee-maker", "printer", "cabinet", "trash",
    ]) {
      this.load.image(key, `sprites/${key}.png`);
    }
  }

  create(): void {
    this.makeTilesetTexture();

    const map = this.make.tilemap({ key: "office" });
    const tiles = map.addTilesetImage("office-tiles", "office-tiles-tex", 16, 16);
    if (!tiles) throw new Error("tileset missing");
    map.createLayer("floor", tiles);
    const walls = map.createLayer("walls", tiles);
    if (!walls) throw new Error("walls layer missing");
    walls.setCollision(2);

    // Decor (placeholder-tier positions).
    this.add.image(52, 40, "water-cooler");
    this.add.image(200, 26, "coffee-maker").setOrigin(0.5, 0.3);
    this.add.image(444, 200, "printer");
    this.add.image(250, 300, "plant");
    this.add.image(330, 250, "trash");

    // One desk + seated worker + status bubble per agent.
    const deskColliders = this.physics.add.staticGroup();
    for (const spec of DESKS) {
      const desk = this.physics.add.staticImage(spec.x, spec.y, "desk-pc");
      desk.setSize(44, 24).setOffset(10, 28);
      deskColliders.add(desk);
      this.add.image(spec.x, spec.y - 14, spec.worker);
      this.add
        .text(spec.x, spec.y - 30, spec.name, { fontSize: "9px", color: "#cdd0db" })
        .setOrigin(0.5)
        .setDepth(10_000);
      const bubble = this.add
        .text(spec.x, spec.y - 46, BUBBLES.idle, { fontSize: "16px" })
        .setOrigin(0.5)
        .setDepth(10_000);
      this.desks.push({ name: spec.name, x: spec.x, y: spec.y, bubble });
    }

    // Player (Julia walk sheets: 4 frames per direction, 64x64).
    this.player = this.physics.add.sprite(220, 180, "julia-down", 0);
    this.player.body?.setSize(12, 8);
    this.player.body?.setOffset(26, 46);
    this.player.setCollideWorldBounds(true);

    for (const dir of ["down", "left", "right", "up"] as const) {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(`julia-${dir}`, { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }

    this.physics.add.collider(this.player, walls);
    this.physics.add.collider(this.player, deskColliders);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setZoom(2);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("keyboard plugin missing");
    this.cursors = keyboard.createCursorKeys();
    this.keys = keyboard.addKeys("W,A,S,D,E") as OfficeScene["keys"];
    keyboard.on("keydown-ESC", () => this.deps.panels.closeChat());

    // Status bubbles render straight off the shared event-driven store.
    const updateBubbles = () => {
      for (const desk of this.desks) {
        const agent = this.deps.state.agents.get(desk.name);
        if (agent) desk.bubble.setText(BUBBLES[agent.status]);
      }
    };
    this.deps.state.onChange(updateBubbles);
    updateBubbles();
  }

  override update(): void {
    const { panels } = this.deps;
    const typing = panels.inputFocused || panels.isChatOpen();

    // -- movement -------------------------------------------------------------
    let vx = 0;
    let vy = 0;
    if (!typing) {
      if (this.cursors.left.isDown || this.keys.A.isDown) vx = -1;
      else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 1;
      if (this.cursors.up.isDown || this.keys.W.isDown) vy = -1;
      else if (this.cursors.down.isDown || this.keys.S.isDown) vy = 1;
    }
    const speed = 110;
    const len = Math.hypot(vx, vy) || 1;
    this.player.setVelocity((vx / len) * speed, (vy / len) * speed);

    if (vx < 0) this.player.anims.play("walk-left", true);
    else if (vx > 0) this.player.anims.play("walk-right", true);
    else if (vy < 0) this.player.anims.play("walk-up", true);
    else if (vy > 0) this.player.anims.play("walk-down", true);
    else this.player.anims.stop();

    this.player.setDepth(this.player.y);

    // -- proximity tiers (against the nearest desk) ---------------------------
    let nearest: DeskView | null = null;
    let nearestDist = Infinity;
    for (const desk of this.desks) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, desk.x, desk.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = desk;
      }
    }

    // Tier 2: activity feed for whichever desk we're near.
    if (nearest && nearestDist <= NEAR_RADIUS) {
      panels.showActivity(nearest.name);
    } else {
      panels.hideActivity();
    }

    // Tier 3: chat on E within chat range; close on leaving range.
    const inChatRange = nearest !== null && nearestDist <= CHAT_RADIUS;
    if (inChatRange && nearest) {
      this.chatTarget = nearest.name;
      if (!panels.isChatOpen()) {
        panels.setHint(`Press E to talk to ${nearest.name}`);
        if (Phaser.Input.Keyboard.JustDown(this.keys.E)) panels.openChat(nearest.name);
      } else {
        panels.setHint("Esc or walk away to close");
      }
    } else {
      if (panels.isChatOpen()) panels.closeChat();
      this.chatTarget = null;
      panels.setHint("");
    }
  }

  /** 3-tile strip (floor, wall, carpet) generated at runtime — no binary tileset. */
  private makeTilesetTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0x23252e).fillRect(0, 0, 16, 16);
    g.fillStyle(0x282a34).fillRect(0, 0, 16, 1).fillRect(0, 0, 1, 16);
    g.fillStyle(0x434965).fillRect(16, 0, 16, 16);
    g.fillStyle(0x333952).fillRect(16, 12, 16, 4);
    g.fillStyle(0x4d547a).fillRect(16, 0, 16, 2);
    g.fillStyle(0x2a3550).fillRect(32, 0, 16, 16);
    g.fillStyle(0x32405f);
    for (let y = 2; y < 16; y += 4) for (let x = 2 + (y % 8) / 2; x < 16; x += 4) g.fillRect(32 + x, y, 1, 1);
    g.generateTexture("office-tiles-tex", 48, 16);
    g.destroy();
  }
}
