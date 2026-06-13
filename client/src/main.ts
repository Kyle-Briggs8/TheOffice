import Phaser from "phaser";
import { Connection } from "./net/connection.js";
import { OfficeState } from "./state/officeState.js";
import { Panels } from "./ui/panels.js";
import { OfficeScene } from "./scenes/OfficeScene.js";

const wsUrl = new URLSearchParams(location.search).get("ws") ?? `ws://${location.hostname}:3001`;

const conn = new Connection(wsUrl);
const state = new OfficeState();
conn.onEvent((event) => state.apply(event));
const panels = new Panels(state, conn);
conn.connect();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 600,
  backgroundColor: "#0c0d12",
  pixelArt: true,
  physics: { default: "arcade" },
  scene: [new OfficeScene({ state, conn, panels })],
});
