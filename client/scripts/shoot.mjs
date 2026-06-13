// Dev tool: screenshot the running game canvas so layout can be judged visually.
// Usage: node scripts/shoot.mjs [outfile] [waitMs]
import puppeteer from "puppeteer";

const out = process.argv[2] ?? "shot.png";
const waitMs = Number(process.argv[3] ?? 2500);
const url = process.env.GAME_URL ?? "http://localhost:5173/";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("console:", m.text());
  });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  await new Promise((r) => setTimeout(r, waitMs)); // let Phaser boot + render
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
