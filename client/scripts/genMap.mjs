// Generates the Tiled JSON office map (client/assets/maps/office.json).
// Tile ids into the generated "office-tiles" tileset: 1 floor, 2 wall, 3 carpet.
//
// Floor plan: open office with an enclosed manager's office in the top-right
// corner (carpet + one doorway). Everything else is open floor; desks and decor
// are placed as sprites in OfficeScene, not baked into the map.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const W = 30;
const H = 20;
const FLOOR = 1;
const WALL = 2;
const CARPET = 3;

// Manager's office (tile coords): room x 20..29, y 0..7, with a door at (20,4).
const room = { x0: 20, y0: 0, x1: 29, y1: 7, doorY: 4 };

const floor = [];
const walls = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inRoom = x >= room.x0 + 1 && x <= room.x1 - 1 && y >= room.y0 + 1 && y <= room.y1 - 1;
    floor.push(inRoom ? CARPET : FLOOR);

    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    // Manager office: left wall (x=20) with a doorway, and bottom wall (y=7).
    const roomLeftWall = x === room.x0 && y >= room.y0 && y <= room.y1 && y !== room.doorY;
    const roomBottomWall = y === room.y1 && x >= room.x0 && x <= room.x1;
    walls.push(border || roomLeftWall || roomBottomWall ? WALL : 0);
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
    // Pixels are generated at runtime (OfficeScene.makeTilesetTexture); this
    // image reference is never fetched.
    image: "office-tiles.png",
    imagewidth: 48,
    imageheight: 16,
  }],
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "maps");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "office.json"), JSON.stringify(map));
console.log(`wrote ${path.join(out, "office.json")} (${W}x${H} tiles, manager office top-right)`);
