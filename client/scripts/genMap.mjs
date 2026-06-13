// Generates the Tiled JSON office map (client/assets/maps/office.json).
// Tile ids into the generated "office-tiles" tileset: 1 floor, 2 wall, 3 carpet.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const W = 30;
const H = 20;
const FLOOR = 1;
const WALL = 2;
const CARPET = 3;

// Carpet zone = jim's corner office area (tile coords, inclusive).
const carpet = { x0: 19, y0: 2, x1: 28, y1: 9 };

const floor = [];
const walls = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inCarpet = x >= carpet.x0 && x <= carpet.x1 && y >= carpet.y0 && y <= carpet.y1;
    floor.push(inCarpet ? CARPET : FLOOR);
    const isWall =
      x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
      (x === 18 && y >= 1 && y <= 6) || // partition around jim's area
      (y === 10 && x >= 22 && x <= 28);
    walls.push(isWall ? WALL : 0);
  }
}

const layer = (id, name, data) => ({
  id, name, data,
  type: "tilelayer", width: W, height: H, x: 0, y: 0, opacity: 1, visible: true,
});

const map = {
  type: "map",
  version: "1.10",
  tiledversion: "1.10.2",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width: W,
  height: H,
  tilewidth: 16,
  tileheight: 16,
  nextlayerid: 3,
  nextobjectid: 1,
  layers: [layer(1, "floor", floor), layer(2, "walls", walls)],
  tilesets: [{
    firstgid: 1,
    name: "office-tiles",
    tilewidth: 16,
    tileheight: 16,
    tilecount: 3,
    columns: 3,
    margin: 0,
    spacing: 0,
    // The actual pixels are generated at runtime (OfficeScene.makeTilesetTexture);
    // this image reference is never fetched.
    image: "office-tiles.png",
    imagewidth: 48,
    imageheight: 16,
  }],
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "maps");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "office.json"), JSON.stringify(map));
console.log(`wrote ${path.join(out, "office.json")} (${W}x${H} tiles)`);
