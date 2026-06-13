// Generates the Tiled JSON office map (client/assets/maps/office.json).
// Tileset "office-tiles": 1 floor, 2 wall, 3 carpet (manager), 4 rug (cubicles).
//
// Floor plan:
//   - break room   (top-left, walled, one door)
//   - manager office (top-right, walled + carpet, one door)
//   - three cubicles in the work area, each grounded on a rug
//   - open meeting space in the lower-middle
// Furniture is placed as sprites in OfficeScene; only walls/floors live here.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const W = 30;
const H = 20;
const FLOOR = 1;
const WALL = 2;
const CARPET = 3;
const RUG = 4;

// Manager office: room x 20..29, y 0..7, door at (20,4).
const mgr = { x0: 20, y0: 0, x1: 29, y1: 7, doorY: 4 };
// Break room: room x 0..9, y 0..6, door at (9,3).
const brk = { x0: 0, y0: 0, x1: 9, y1: 6, doorY: 3 };
// Cubicle rugs (each 5 wide x 4 tall) under the three desks.
const rugs = [
  { x0: 2, y0: 10, x1: 6, y1: 13 },
  { x0: 12, y0: 10, x1: 16, y1: 13 },
  { x0: 22, y0: 10, x1: 26, y1: 13 },
];

// Common-area carpet grounding the meeting table in the lower-middle.
const meeting = { x0: 13, y0: 14, x1: 17, y1: 16 };

const inBox = (x, y, b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

const floor = [];
const walls = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let tile = FLOOR;
    if (x >= mgr.x0 + 1 && x <= mgr.x1 - 1 && y >= mgr.y0 + 1 && y <= mgr.y1 - 1) tile = CARPET;
    else if (inBox(x, y, meeting)) tile = CARPET;
    else if (rugs.some((r) => inBox(x, y, r))) tile = RUG;
    floor.push(tile);

    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    const mgrWall =
      (x === mgr.x0 && y >= mgr.y0 && y <= mgr.y1 && y !== mgr.doorY) ||
      (y === mgr.y1 && x >= mgr.x0 && x <= mgr.x1);
    const brkWall =
      (x === brk.x1 && y >= brk.y0 && y <= brk.y1 && y !== brk.doorY) ||
      (y === brk.y1 && x >= brk.x0 && x <= brk.x1);
    walls.push(border || mgrWall || brkWall ? WALL : 0);
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
    tilecount: 4,
    columns: 4,
    margin: 0,
    spacing: 0,
    // Pixels generated at runtime (OfficeScene.makeTilesetTexture); never fetched.
    image: "office-tiles.png",
    imagewidth: 64,
    imageheight: 16,
  }],
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "maps");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "office.json"), JSON.stringify(map));
console.log(`wrote ${path.join(out, "office.json")} (${W}x${H}, break room + manager office + 3 cubicles)`);
