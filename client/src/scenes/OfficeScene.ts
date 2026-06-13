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

/** The manager office (inside the top-right room): walk near to open reviews. */
const MANAGER = { x: 392, y: 64 };
const MANAGER_RADIUS = 84;

/** Desk layout: one per agent, each centered on its cubicle rug. */
const DESKS: ReadonlyArray<{ name: string; x: number; y: number; worker: string }> = [
  { name: "jim", x: 72, y: 184, worker: "worker" },
  { name: "dwight", x: 232, y: 184, worker: "worker2" },
  { name: "pam", x: 392, y: 184, worker: "worker4" },
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
  private managerBubble!: Phaser.GameObjects.Text;

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
      "worker", "worker2", "worker4", "boss", "desk-pc", "plant",
      "water-cooler", "coffee-maker", "printer", "cabinet", "trash",
      "sink", "writing-table", "meeting-table", "chair",
      "partition-corner", "partition-v",
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

    const deskColliders = this.physics.add.staticGroup();

    // Break room (top-left): counter + appliances along the walls.
    this.decor(40, 30, "sink");
    this.decor(104, 30, "coffee-maker");
    this.decor(24, 78, "water-cooler");
    this.decor(128, 76, "cabinet");

    // Manager office (top-right): a bookshelf and a plant beside the boss.
    this.decor(348, 36, "writing-table");
    this.decor(452, 34, "plant");

    // Three cubicles: a partition backdrop behind each desk, then the seat.
    for (const spec of DESKS) {
      this.add.image(spec.x, spec.y - 30, "partition-corner").setDepth(spec.y - 2);
      this.seat(spec.x, spec.y, spec.worker, deskColliders);
      this.add
        .text(spec.x, spec.y - 34, spec.name, { fontSize: "9px", color: "#cdd0db" })
        .setOrigin(0.5)
        .setDepth(20_000);
      const bubble = this.add
        .text(spec.x, spec.y - 48, BUBBLES.idle, { fontSize: "16px" })
        .setOrigin(0.5)
        .setDepth(20_000);
      this.desks.push({ name: spec.name, x: spec.x, y: spec.y, bubble });
    }
    // Vertical dividers between the cubicles.
    this.decor(152, 184, "partition-v");
    this.decor(312, 184, "partition-v");

    // Manager (inside the top-right room): the boss at his desk.
    this.seat(MANAGER.x, MANAGER.y, "boss", deskColliders);
    this.add
      .text(MANAGER.x, MANAGER.y - 34, "manager", { fontSize: "9px", color: "#d4a5ff" })
      .setOrigin(0.5)
      .setDepth(20_000);
    this.managerBubble = this.add
      .text(MANAGER.x, MANAGER.y - 48, "", { fontSize: "13px", color: "#d4a5ff" })
      .setOrigin(0.5)
      .setDepth(20_000);

    // Meeting area filling the lower-middle: a table ringed by chairs.
    this.decor(240, 270, "chair");
    this.decor(240, 250, "meeting-table");
    this.decor(208, 268, "chair");
    this.decor(272, 268, "chair");

    // Plants in the far corners + a printer and bin against the walls.
    this.decor(24, 300, "plant");
    this.decor(456, 300, "plant");
    this.decor(452, 232, "printer");
    this.decor(40, 232, "trash");

    // Player (Julia walk sheets: 4 frames per direction, 64x64).
    this.player = this.physics.add.sprite(300, 130, "julia-down", 0);
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
    // Default 2x; override with ?zoom=N (handy for seeing the whole floor plan).
    const zoom = Number(new URLSearchParams(location.search).get("zoom"));
    this.cameras.main.setZoom(Number.isFinite(zoom) && zoom > 0 ? zoom : 2);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("keyboard plugin missing");
    this.cursors = keyboard.createCursorKeys();
    this.keys = keyboard.addKeys("W,A,S,D,E") as OfficeScene["keys"];
    keyboard.on("keydown-ESC", () => this.deps.panels.closeChat());

    // Status bubbles + the manager's review-count badge render straight off the
    // shared event-driven store.
    const updateBubbles = () => {
      for (const desk of this.desks) {
        const agent = this.deps.state.agents.get(desk.name);
        if (agent) desk.bubble.setText(BUBBLES[agent.status]);
      }
      const pending = this.deps.state.reviews.size;
      this.managerBubble.setText(pending > 0 ? `📋 ${pending}` : "");
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

    // -- manager office: open the review panel on proximity --------------------
    const managerDist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, MANAGER.x, MANAGER.y,
    );
    if (managerDist <= MANAGER_RADIUS) {
      panels.showReview();
    } else {
      panels.hideReview();
    }

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

  /** Static decor, depth-sorted by its base so the player walks in front/behind. */
  private decor(x: number, y: number, key: string): void {
    this.add.image(x, y, key).setDepth(y);
  }

  /**
   * A worker seated at a desk: the worker is drawn slightly up and behind, the
   * desk in front (occluding their lower half) so it reads as "sitting at it".
   * Adds a collider on the desk footprint only.
   */
  private seat(
    x: number,
    y: number,
    worker: string,
    colliders: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.add.image(x, y - 16, worker).setDepth(y - 1);
    const desk = this.physics.add.staticImage(x, y, "desk-pc").setDepth(y);
    desk.body.setSize(52, 26).setOffset(6, 30);
    colliders.add(desk);
  }

  /** 4-tile strip (floor, wall, carpet, rug) generated at runtime — no binary tileset. */
  private makeTilesetTexture(): void {
    const g = this.add.graphics();
    // tile 1: floor — subtle checker + grid so the open space isn't a flat void.
    g.fillStyle(0x262833).fillRect(0, 0, 16, 16);
    g.fillStyle(0x2b2d39).fillRect(0, 0, 8, 8).fillRect(8, 8, 8, 8);
    g.fillStyle(0x1f2029).fillRect(0, 15, 16, 1).fillRect(15, 0, 1, 16);
    // tile 2: wall
    g.fillStyle(0x434965).fillRect(16, 0, 16, 16);
    g.fillStyle(0x333952).fillRect(16, 12, 16, 4);
    g.fillStyle(0x4d547a).fillRect(16, 0, 16, 2);
    // tile 3: carpet (manager — cool blue)
    g.fillStyle(0x2a3550).fillRect(32, 0, 16, 16);
    g.fillStyle(0x32405f);
    for (let y = 2; y < 16; y += 4) for (let x = 2 + (y % 8) / 2; x < 16; x += 4) g.fillRect(32 + x, y, 1, 1);
    // tile 4: rug (cubicle — warm) with a border so pods read as defined areas.
    g.fillStyle(0x3a3330).fillRect(48, 0, 16, 16);
    g.fillStyle(0x4a4038).fillRect(48, 0, 16, 1).fillRect(48, 15, 16, 1).fillRect(48, 0, 1, 16).fillRect(63, 0, 1, 16);
    g.generateTexture("office-tiles-tex", 64, 16);
    g.destroy();
  }
}
