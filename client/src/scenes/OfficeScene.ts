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
};

/** Proximity tiers (world px from the desk): far → near (panel) → chat (E). */
const NEAR_RADIUS = 84;
const CHAT_RADIUS = 52;

interface Deps {
  state: OfficeState;
  conn: Connection;
  panels: Panels;
}

export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private keys!: Record<"W" | "A" | "S" | "D" | "E", Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private bubble!: Phaser.GameObjects.Text;
  private readonly jimDesk = { x: 380, y: 92 };
  private nearDesk = false;

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
    for (const key of ["worker", "desk-pc", "plant", "water-cooler", "coffee-maker", "printer", "cabinet", "trash"]) {
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

    // Decor (positions are placeholder-tier; collision only where it matters).
    this.add.image(52, 40, "water-cooler");
    this.add.image(120, 28, "cabinet");
    this.add.image(200, 26, "coffee-maker").setOrigin(0.5, 0.3);
    this.add.image(444, 200, "printer");
    this.add.image(40, 286, "plant");
    this.add.image(440, 286, "plant");
    this.add.image(330, 250, "trash");

    // jim's corner office: desk + seated worker sprite.
    const desk = this.physics.add.staticImage(this.jimDesk.x, this.jimDesk.y, "desk-pc");
    desk.setSize(44, 24).setOffset(10, 28);
    this.add.image(this.jimDesk.x, this.jimDesk.y - 14, "worker");
    this.bubble = this.add
      .text(this.jimDesk.x, this.jimDesk.y - 46, BUBBLES.idle, { fontSize: "16px" })
      .setOrigin(0.5)
      .setDepth(10_000);

    // Player (Julia walk sheets: 4 frames per direction, 64x64).
    this.player = this.physics.add.sprite(140, 220, "julia-down", 0);
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
    this.physics.add.collider(this.player, desk);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setZoom(2);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("keyboard plugin missing");
    this.cursors = keyboard.createCursorKeys();
    this.keys = keyboard.addKeys("W,A,S,D,E") as OfficeScene["keys"];
    keyboard.on("keydown-ESC", () => this.deps.panels.closeChat());

    // Status bubble renders straight off the shared event-driven store.
    const updateBubble = () => {
      const jim = this.deps.state.agents.get("jim");
      if (jim) this.bubble.setText(BUBBLES[jim.status]);
    };
    this.deps.state.onChange(updateBubble);
    updateBubble();
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

    // -- proximity tiers --------------------------------------------------------
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, this.jimDesk.x, this.jimDesk.y,
    );

    const near = dist <= NEAR_RADIUS;
    if (near !== this.nearDesk) {
      this.nearDesk = near;
      if (near) panels.showActivity("jim");
      else panels.hideActivity();
    }

    const inChatRange = dist <= CHAT_RADIUS;
    if (!inChatRange && panels.isChatOpen()) panels.closeChat();
    if (inChatRange && !panels.isChatOpen()) {
      panels.setHint("Press E to talk to jim");
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) panels.openChat("jim");
    } else {
      panels.setHint(panels.isChatOpen() ? "Esc or walk away to close" : "");
    }
  }

  /** 3-tile strip (floor, wall, carpet) generated at runtime — no binary tileset. */
  private makeTilesetTexture(): void {
    const g = this.add.graphics();
    // tile 1: floor
    g.fillStyle(0x23252e).fillRect(0, 0, 16, 16);
    g.fillStyle(0x282a34).fillRect(0, 0, 16, 1).fillRect(0, 0, 1, 16);
    // tile 2: wall
    g.fillStyle(0x434965).fillRect(16, 0, 16, 16);
    g.fillStyle(0x333952).fillRect(16, 12, 16, 4);
    g.fillStyle(0x4d547a).fillRect(16, 0, 16, 2);
    // tile 3: carpet
    g.fillStyle(0x2a3550).fillRect(32, 0, 16, 16);
    g.fillStyle(0x32405f);
    for (let y = 2; y < 16; y += 4) for (let x = 2 + (y % 8) / 2; x < 16; x += 4) g.fillRect(32 + x, y, 1, 1);
    g.generateTexture("office-tiles-tex", 48, 16);
    g.destroy();
  }
}
