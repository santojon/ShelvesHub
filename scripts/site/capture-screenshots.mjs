#!/usr/bin/env node
/*
 * Capture a screenshot of the Steam Big Picture window over the CEF debug port
 * (the same port shelves-devtools uses). Open the view you want on screen first,
 * then run this with a name — it writes site/img/<name>.png, ready for the
 * landing page's gallery and the next Pages publish.
 *
 * Prereqs: Steam launched with CEF remote debugging (a
 * `.cef-enable-remote-debugging` flag / `-cef-enable-remote-debugging` arg), and
 * Big Picture open. See docs/showcase.md.
 *
 * Usage:
 *   node scripts/site/capture-screenshots.mjs home
 *   node scripts/site/capture-screenshots.mjs qam-tab --port 8080 --out site/img
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const name = (args.find((a) => !a.startsWith("--")) || "screenshot").replace(/[^a-z0-9_-]/gi, "-");
const host = argVal("--host") || "127.0.0.1";
const port = argVal("--port") || "8080";
const outDir = argVal("--out") || resolve(process.cwd(), "site/img");

// Fail fast rather than hang — the CEF debug port can wedge when another CDP
// client (the running daemon) holds it, so stop the daemon before capturing.
const HARD_TIMEOUT_MS = 20000;
setTimeout(() => { console.error(`Timed out after ${HARD_TIMEOUT_MS}ms — is Big Picture open and the daemon stopped?`); process.exit(1); }, HARD_TIMEOUT_MS).unref?.();

const targets = await (await fetch(`http://${host}:${port}/json`)).json();
// Big Picture window title is localized ("Big Picture" / "Modo Big Picture" / ...),
// so match the shared "Big Picture" substring, then fall back to the gamepad UI URL.
const bp =
  targets.find((t) => t.type === "page" && /big picture/i.test(t.title || "")) ||
  targets.find((t) => t.type === "page" && /gamepadui|bigpicture/i.test(t.url || ""));
if (!bp?.webSocketDebuggerUrl) {
  console.error("Big Picture target not found — open Big Picture first. Saw:", targets.map((t) => t.title));
  process.exit(1);
}

const ws = new WebSocket(bp.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (e) => {
  const text = typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8");
  let m; try { m = JSON.parse(text); } catch { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });

await send("Page.enable");
const shot = await send("Page.captureScreenshot", { format: "png" });
if (!shot?.data) { console.error("captureScreenshot returned no data"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${name}.png`);
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(`Saved ${out}`);
ws.close();
process.exit(0);
