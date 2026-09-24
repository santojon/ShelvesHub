#!/usr/bin/env node
/* Builds site/index.html's "What's New" list and site/features.html's
   feature list from RELEASE_NOTES.md / README.md, in English and pt-BR
   (tagged `data-lang-variant`, toggled by each page's own i18n script).
   See docs/pt-BR/ for the translated sources. Safe to run repeatedly.
   Usage: node scripts/build-site.mjs [--root .] */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function root() {
  const idx = process.argv.indexOf("--root");
  const arg = idx !== -1 ? process.argv[idx + 1] : ".";
  return resolve(arg);
}

function read(path) {
  return readFileSync(path, "utf8");
}

// Convert a small subset of Markdown (bold, code, links) to HTML — mirrors
// build_site.py's `_md_inline`.
function mdInline(text) {
  let s = text.trim()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const idx = Number(mo) - 1;
  if (idx < 0 || idx > 11) return iso;
  return `${MONTHS[idx]} ${Number(d)}, ${y}`;
}

/* Group a release section's raw lines into bullets — RELEASE_NOTES.md here
   wraps a bullet's prose across multiple indented continuation lines, so
   continuation lines (start with whitespace, non-empty) are folded back
   onto the bullet that owns them before the `- **Title.** rest` split runs. */
function groupBulletLines(body) {
  const out = [];
  let current = null;
  for (const raw of body.split("\n")) {
    if (/^-\s+/.test(raw)) {
      if (current !== null) out.push(current);
      current = raw.trim();
    } else if (current !== null && raw.trim()) {
      current += " " + raw.trim();
    }
  }
  if (current !== null) out.push(current);
  return out;
}

// Parse (version, isoDate, [[title, desc], ...]) for the latest release out
// of a RELEASE_NOTES.md-shaped file. `[Unreleased]` has no date so the
// `## [x.y.z] - date` regex naturally skips straight to the newest real tag.
function parseRelease(notesPath) {
  if (!existsSync(notesPath)) return null;
  const text = read(notesPath);
  const m = /^##\s*\[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/m.exec(text);
  if (!m) return null;
  const [, version, iso] = m;

  let body = text.slice(m.index + m[0].length);
  const nxt = /^##\s*\[/m.exec(body);
  if (nxt) body = body.slice(0, nxt.index);

  const items = [];
  for (const bullet of groupBulletLines(body)) {
    const bm = /^-\s+\*\*(.+?)\*\*(.*)$/.exec(bullet);
    if (!bm) continue;
    const title = bm[1].trim().replace(/\.$/, "");
    const rest = bm[2].trim();
    let sentence = rest ? (rest.split(/(?<=[.!?])\s/)[0]) : "";
    if (sentence.length > 210) sentence = sentence.slice(0, 207).replace(/\s\S*$/, "") + "…";
    items.push([title, sentence]);
    if (items.length >= 4) break;
  }
  if (!items.length) return null;
  return { version, iso, items };
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function releaseItemsHtml(items, lang) {
  return items.map(([t, d]) =>
    `          <li data-lang-variant="${lang}">\n            <b>${escapeHtml(t)}</b>\n` +
    `            <p>${mdInline(d)}</p>\n          </li>`
  ).join("\n");
}

function injectRelease(page, version, iso, items, itemsPt) {
  const dateStr = fmtDate(iso);
  let li = releaseItemsHtml(items, "en");
  if (itemsPt && itemsPt.length) li += "\n" + releaseItemsHtml(itemsPt, "pt");

  page = page.replace(/(<span data-rn-version>).*?(<\/span>)/s, `$1v${version}$2`);
  page = page.replace(/(<span data-rn-date>).*?(<\/span>)/s, `$1${dateStr}$2`);
  page = page.replace(/(<ul class="rn-list" data-rn-list>).*?(<\/ul>)/s, `$1\n${li}\n      $2`);
  return page;
}

// Parse a flat `## {heading}` bullet list (no nesting today, but tolerate a
// nested nested `- ` nonetheless — same shape build_site.py's `_parseFeatures` uses).
function parseFeatures(readmePath, heading) {
  if (!existsSync(readmePath)) return null;
  const text = read(readmePath);
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^##\\s+${escaped}\\s*$`, "m").exec(text);
  if (!m) return null;
  let body = text.slice(m.index + m[0].length);
  const nxt = /^##\s+/m.exec(body);
  if (nxt) body = body.slice(0, nxt.index);

  const items = [];
  for (const raw of body.split("\n")) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (!content.startsWith("- ")) continue;
    items.push([indent, mdInline(content.slice(2))]);
  }
  return items.length ? items : null;
}

function featuresListHtml(items, lang) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const [indent, content] = items[i];
    const children = [];
    let j = i + 1;
    while (j < items.length && items[j][0] > indent) { children.push(items[j]); j++; }
    if (children.length) {
      const sub = children.map(([, c]) => `<li>${c}</li>`).join("");
      out.push(`<li data-lang-variant="${lang}">${content}<ul class="sub">${sub}</ul></li>`);
    } else {
      out.push(`<li data-lang-variant="${lang}">${content}</li>`);
    }
    i = children.length ? j : i + 1;
  }
  return out.join("");
}

function injectFeaturesList(page, itemsHtml) {
  return page.replace(/(<ul class="features-list">)[\s\S]*?(<\/ul>)/, `$1\n${itemsHtml}\n        $2`);
}

function main() {
  const rootDir = root();
  const site = join(rootDir, "site");
  const indexPath = join(site, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`[build-site] site/index.html not found under ${rootDir}`);
    return 0;
  }

  let page = read(indexPath);

  const rel = parseRelease(join(rootDir, "RELEASE_NOTES.md"));
  if (rel) {
    const relPt = parseRelease(join(rootDir, "docs", "pt-BR", "RELEASE_NOTES.md"));
    const itemsPt = relPt && relPt.version === rel.version ? relPt.items : null;
    page = injectRelease(page, rel.version, rel.iso, rel.items, itemsPt);
    writeFileSync(indexPath, page, "utf8");
    const ptNote = itemsPt ? ` + ${itemsPt.length} pt-BR` : " (pt-BR not caught up yet, falls back to English)";
    console.log(`[build-site] release: v${rel.version} (${rel.iso}), ${rel.items.length} highlights${ptNote}`);
  } else {
    console.warn("[build-site] WARN: could not parse RELEASE_NOTES.md; kept existing block");
  }

  const featuresPath = join(site, "features.html");
  if (existsSync(featuresPath)) {
    const feats = parseFeatures(join(rootDir, "README.md"), "Features");
    if (feats) {
      let html = featuresListHtml(feats, "en");
      const featsPt = parseFeatures(join(rootDir, "docs", "pt-BR", "README.md"), "Funcionalidades");
      let ptNote = "";
      if (featsPt) {
        html += featuresListHtml(featsPt, "pt");
        ptNote = ` + ${featsPt.length} pt-BR`;
      }
      const featuresPage = injectFeaturesList(read(featuresPath), html);
      writeFileSync(featuresPath, featuresPage, "utf8");
      console.log(`[build-site] features.html: ${feats.length} items${ptNote}`);
    } else {
      console.warn("[build-site] WARN: could not parse README Features section");
    }
  }

  return 0;
}

main();
