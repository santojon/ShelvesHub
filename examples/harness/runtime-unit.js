/* examples/harness/runtime-unit.js — evaluates the runtime the way the daemon assembles it (one
   IIFE) in a node vm with stubbed renderer globals, for what a page cannot show: the nav prune
   across a teardown, host.routes following host.routerHook, the locale pick, the capabilities, the
   Quick Access mode without a native tab, the bundle boot gate, the handshake following the daemon's
   stamp, a fake render outside a React render. Usage: node runtime-unit.js [repo root]; exit 1 on a problem. */

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = process.argv[2] || path.join(__dirname, "..", "..");
const PARTS = ["shelves-host.js", "shelves-host-qam.js", "shelves-host-api.js", "shelves-host-sidecar.js", "shelves-host-toast.js"];
const BODY = PARTS.map(function (p) { return fs.readFileSync(path.join(ROOT, "runtime", p), "utf8"); }).join("\n");
// `probe` is test-only source appended inside the closure: the one way at a private helper.
function source(probe) { return "(function () {\n\"use strict\";\n" + BODY + "\n" + (probe || "") + "\n})();\n"; }

const results = [];
function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: detail }); }

// A renderer stand-in: the globals the runtime touches at boot; intervals kept for inspection.
function boot(opts) {
  const timers = { intervals: new Map(), next: 1 };
  const w = {};
  w.window = w; w.globalThis = w;
  w.console = { log: function () {}, warn: function () {}, error: function () {} };
  w.navigator = { language: opts.navLang || "en-US", userAgent: "vm" };
  w.location = { href: opts.href || "https://steamloopback.host/index.html" };
  w.document = { hidden: false, getElementById: function () { return null; }, addEventListener: function () {}, removeEventListener: function () {} };
  w.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  w.setTimeout = function () { return 0; };
  w.clearTimeout = function () {};
  w.setInterval = function (fn, ms) { const id = timers.next++; timers.intervals.set(id, { fn: fn, ms: ms }); return id; };
  w.clearInterval = function (id) { timers.intervals.delete(id); };
  w.fetch = function () { return Promise.reject(new Error("no network")); };
  w.__SHELVES_CONFIG__ = Object.assign({ rpcEndpoint: "http://127.0.0.1:1", hostApiVersion: "1.5.0", rpcToken: "t" }, opts.config || {});
  w.__SHELVES_I18N__ = opts.dicts || {};
  Object.keys(opts.globals || {}).forEach(function (k) { w[k] = opts.globals[k]; });
  vm.createContext(w);
  vm.runInContext(source(opts.probe), w, { filename: "shelves-host.js" });
  return { w: w, timers: timers };
}
function liveIntervals(timers, ms) {
  return Array.from(timers.intervals.values()).filter(function (t) { return t.ms === ms; });
}
function routerSpies(calls) {
  const spy = function (name) { return function (p, x) { calls.push(name + " " + p); return x; }; };
  return { addRoute: spy("addRoute"), removeRoute: spy("removeRoute"), addPatch: spy("addPatch"), removePatch: spy("removePatch") };
}

function soleHostChecks() {
  const b = boot({ dicts: { "en-US": { hub_title: "Hub" } } });
  const host = b.w.__SHELVES_HOST__;
  check("sole: host published", host && host.__shelvesRuntime, typeof host);
  const armed = liveIntervals(b.timers, 500);
  check("sole: nav prune armed at boot", armed.length === 1, armed.length);
  const n1 = host.lifecycle.teardown();
  const n2 = host.lifecycle.teardown();
  const after = liveIntervals(b.timers, 500).length;
  check("sole: every teardown stops the prune and re-arms exactly one", n1 === 1 && n2 === 1 && after === 1, n1 + "/" + n2 + "/" + after);
  const c = host.handshake().capabilities;
  check("sole: selfUpdate and canSelfInstall, no tab inserted yet", c.selfUpdate === true && host.updates.canSelfInstall() === true && c.nativeQam === false && c.coexist === false, JSON.stringify(c));
  pruneGuardChecks(b, armed[0].fn);
  routesChecks(host);
}

// The prune reads the Home window's visibility, else this document's (count tree reads per run).
function pruneGuardChecks(b, prune) {
  let reads = 0;
  const runs = function () { const before = reads; prune(); return reads - before; };
  b.w.FocusNavController = { m_ActiveContext: { get m_rgGamepadNavigationTrees() { reads++; return []; } } };
  const home = { m_BrowserWindow: { document: { hidden: true } } };
  b.w.SteamUIStore = { WindowStore: { GamepadUIMainWindowInstance: home } };
  const hiddenHome = runs();
  home.m_BrowserWindow.document.hidden = false;
  const shownHome = runs();
  delete b.w.SteamUIStore;
  b.w.document.hidden = true;
  const hiddenDoc = runs();
  b.w.document.hidden = false;
  const shownDoc = runs();
  check("prune: paused while the Home window is hidden, runs when shown", hiddenHome === 0 && shownHome > 0, hiddenHome + "/" + shownHome);
  check("prune: falls back to this document's visibility", hiddenDoc === 0 && shownDoc > 0, hiddenDoc + "/" + shownDoc);
}

function routesChecks(host) {
  const calls = [];
  host.routerHook = routerSpies(calls);
  const comp = function () {};
  host.routes.register("/x", comp).dispose();
  host.routes.addRoute("/y", comp, { exact: true });
  host.routes.removeRoute("/y");
  const p = host.routes.addPatch("/library/home", comp);
  host.routes.removePatch("/library/home", p);
  const want = "addRoute /x|removeRoute /x|addRoute /y|removeRoute /y|addPatch /library/home|removePatch /library/home";
  check("routes: host.routes follows whatever host.routerHook holds", calls.join("|") === want && p === comp, calls.join("|"));
}

// Without the native tab in the menu (switched off, or the menu not found yet) the mode reads "panel".
function qamModeChecks() {
  const off = boot({}).w.__SHELVES_QAM__.mode();
  const pending = boot({ globals: { __SHELVES_NATIVE_QAM__: true } }).w.__SHELVES_QAM__.mode();
  check("qam: mode() reads panel while no native tab is in the menu", off === "panel" && pending === "panel", off + "/" + pending);
}

function localeOf(href, navLang) {
  const dicts = { "en-US": { hub_title: "en-US" }, "pt-BR": { hub_title: "pt-BR" }, "pt-PT": { hub_title: "pt-PT" }, "zh-CN": { hub_title: "zh-CN" } };
  const b = boot({ href: href, navLang: navLang, dicts: dicts });
  b.w.__SHELVES_NOTIFY__("notice_recovered", {});
  return b.w.__SHELVES_HOST__.notifications.list()[0].title;
}
function localeChecks() {
  const steam = "https://steamloopback.host/index.html?LOCAL_HOSTNAME=x&LANGUAGE=";
  const cases = [
    ["Steam's language beats navigator.language", steam + "brazilian&COUNTRY=BR", "en-US", "pt-BR"],
    ["a Steam name maps to its locale code", steam + "schinese", "en-US", "zh-CN"],
    ["no LANGUAGE parameter: navigator.language", "https://steamloopback.host/routes/library/home", "pt-PT", "pt-PT"],
    ["an unknown Steam name: navigator.language", steam + "czech", "en-US", "en-US"],
    ["a prototype key is not a language", steam + "constructor", "pt-PT", "pt-PT"],
    ["a prototype setter is not a language", steam + "__proto__", "en-US", "en-US"],
  ];
  cases.forEach(function (c) {
    const got = localeOf(c[1], c[2]);
    check("locale: " + c[0], got === c[3], got);
  });
}

function cooperativeChecks() {
  const calls = [];
  const dfl = { definePlugin: function (fn) { return fn; }, routerHook: routerSpies(calls) };
  const plain = boot({ globals: { DFL: dfl } });
  check("coexist: host not published beside a loader", !plain.w.__SHELVES_HOST__, typeof plain.w.__SHELVES_HOST__);
  const coop = boot({ globals: { DFL: dfl, __SHELVES_FORCE_OWNER__: "shelveshub" } });
  const host = coop.w.__SHELVES_HOST__;
  check("coop: host published, loader's copy runs: no self-install", host && host.handshake().capabilities.selfUpdate === false && host.updates.canSelfInstall() === false, typeof host);
  host.routes.register("/x", function () {}).dispose();
  check("coop: routes reach the loader's router hook", calls.join("|") === "addRoute /x|removeRoute /x", calls.join("|"));
  check("coop: no nav prune beside a loader", liveIntervals(coop.timers, 500).length === 0, liveIntervals(coop.timers, 500).length);
  const defer = { loaderVersion: "0.0.0", hostBundleVersion: "0.0.1", at: 1 };
  const bundle = boot({ config: { coopBundle: true }, globals: { DFL: dfl, __SHELVES_FORCE_OWNER__: "shelveshub", __DECK_SHELVES_DEFER_TO_HOST__: defer } });
  const h2 = bundle.w.__SHELVES_HOST__;
  const offered = h2.handshake().capabilities.selfUpdate === true && h2.updates.canSelfInstall() === true;
  delete bundle.w.__DECK_SHELVES_DEFER_TO_HOST__;
  const cleared = h2.handshake().capabilities.selfUpdate === false;
  bundle.w.__DECK_SHELVES_HOST_BUNDLE_BOOTED__ = "0.0.1";
  const booted = h2.handshake().capabilities.selfUpdate === true && h2.updates.canSelfInstall() === true;
  check("coop bundle: self-install once the loader's copy stood down or our copy booted", offered && cleared && booted, offered + "/" + cleared + "/" + booted);
  const noConfig = boot({ globals: { DFL: dfl, __SHELVES_FORCE_OWNER__: "shelveshub", __DECK_SHELVES_DEFER_TO_HOST__: defer } });
  check("coop bundle: a stale defer signal without the config stays false", noConfig.w.__SHELVES_HOST__.handshake().capabilities.selfUpdate === false, "");
}

// The handshake reads the daemon's stamp per call: a re-injection writes a new object (a hot-swap
// carries the new bundle version); without the global, the object captured at boot answers.
function stampChecks() {
  const b = boot({ config: { hostVersion: "0.6.0", bundleVersion: "v3.4.0", device: { kind: "desktop", arch: "aarch64" } } });
  const host = b.w.__SHELVES_HOST__;
  const first = host.handshake();
  b.w.__SHELVES_CONFIG__ = Object.assign({}, b.w.__SHELVES_CONFIG__, { hostVersion: "0.6.1", bundleVersion: "v3.4.1", device: { kind: "deck", arch: "x86_64" }, coopBundle: true });
  const swapped = host.handshake();
  delete b.w.__SHELVES_CONFIG__;
  const fallback = host.handshake();
  check("stamp: the handshake follows a rewritten config stamp",
    swapped.hostVersion === "0.6.1" && swapped.bundleVersion === "v3.4.1" && swapped.device.kind === "deck" && swapped.capabilities.coopBundle === true, JSON.stringify(swapped));
  check("stamp: the capture at boot answers without the global",
    first.bundleVersion === "v3.4.0" && fallback.hostVersion === "0.6.0" && fallback.bundleVersion === "v3.4.0" && fallback.device.arch === "aarch64" && fallback.capabilities.coopBundle === false, JSON.stringify(fallback));
}

// A React stand-in in each internals shape: its hooks read the dispatcher slot (null outside a
// render), which is where the runtime's fake render must put its stub — React 19 the client
// internals' `H`, React 18 the secret internals' `ReactCurrentDispatcher.current`.
function fakeReact(major) {
  const ci = { H: null, A: null, T: null, S: null, V: null };
  const d = { ReactCurrentDispatcher: { current: null } };
  const R = { version: major + ".0.0", createElement: function (t, p) { return { type: t, props: p || {} }; }, Fragment: "f", Component: function () {} };
  if (major === 19) R.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ci;
  else R.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = d;
  R.slot = function () { return major === 19 ? ci.H : d.ReactCurrentDispatcher.current; };
  R.install = function (h) { if (major === 19) ci.H = h; else d.ReactCurrentDispatcher.current = h; };
  ["useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext", "useLayoutEffect"].forEach(function (n) {
    R[n] = function () { const h = R.slot(); return h[n].apply(h, arguments); };
  });
  return R;
}
// The private helper, reached through the probe; a boot failure answers as the render's result.
function fakeRenderHelper(R) {
  try {
    const b = boot({ probe: "window.__UNIT__ = { fakeRenderComponent: fakeRenderComponent };", globals: { SP_REACT: R } });
    return b.w.__UNIT__.fakeRenderComponent;
  } catch (e) { return function () { return "boot threw: " + (e && e.message); }; }
}
function fakeRenderChecks() {
  [18, 19].forEach(function (major) {
    const R = fakeReact(major);
    const fr = fakeRenderHelper(R);
    const Hooked = function () { const s = R.useState(7); R.useEffect(function () {}); return s[0]; };
    const outside = fr(Hooked);
    check("fake render " + major + ": a hooked component renders outside a render, the slot put back", outside === 7 && R.slot() === null, outside + "/" + R.slot());
    // Inside a render the stubs go onto the installed dispatcher and its members come back after.
    const live = { useState: function () { return ["live"]; }, useEffect: function () {} };
    const saved = { useState: live.useState, useEffect: live.useEffect };
    R.install(live);
    const inside = fr(Hooked);
    const restored = R.slot() === live && live.useState === saved.useState && live.useEffect === saved.useEffect;
    check("fake render " + major + ": an installed dispatcher is stubbed in place and restored", inside === 7 && restored, inside + "/" + restored);
  });
}

// The daemon's gate around the bundle, read from src/loader/mod.rs: an overlapping evaluation
// (a re-inject while the UI scan is pending) must leave one poll and boot the bundle once.
function rustStr(src, name) {
  const m = new RegExp("const " + name + ": &str = (\"(?:[^\"\\\\]|\\\\.)*\");").exec(src);
  try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; }
}
function gateContext(ready) {
  const ctx = { setInterval: setInterval, clearInterval: clearInterval };
  ctx.window = ctx;
  if (ready) ctx.__SHELVES_UI_READY__ = true;
  vm.createContext(ctx);
  return ctx;
}
function gateChecks(done) {
  const modrs = fs.readFileSync(path.join(ROOT, "src", "loader", "mod.rs"), "utf8");
  const prefix = rustStr(modrs, "BUNDLE_GATE_PREFIX"), suffix = rustStr(modrs, "BUNDLE_GATE_SUFFIX");
  check("gate: constants readable from src/loader/mod.rs", prefix && suffix, prefix ? "suffix missing" : "prefix missing");
  if (!prefix || !suffix) return done();
  const gate = prefix + "window.__boots=(window.__boots||0)+1;" + suffix;
  const ready = gateContext(true);
  vm.runInContext(gate, ready);
  check("gate: a ready renderer boots at once, no poll", ready.__boots === 1 && ready.__SHELVES_BUNDLE_GATE__ === undefined, ready.__boots);
  const ctx = gateContext(false);
  vm.runInContext(gate, ctx);
  const first = ctx.__SHELVES_BUNDLE_GATE__;
  vm.runInContext(gate, ctx);
  check("gate: an overlapping evaluation replaces the poll handle", first && ctx.__SHELVES_BUNDLE_GATE__ && ctx.__SHELVES_BUNDLE_GATE__ !== first, String(first));
  setTimeout(function () {
    ctx.__SHELVES_UI_READY__ = true;
    setTimeout(function () {
      const boots = ctx.__boots, handle = ctx.__SHELVES_BUNDLE_GATE__;
      setTimeout(function () {
        check("gate: one boot per renderer, handle cleared, no orphan poll", boots === 1 && handle === null && ctx.__boots === 1, boots + "/" + ctx.__boots + "/" + handle);
        done();
      }, 300);
    }, 60);
  }, 100);
}

function report() {
  let bad = 0;
  results.forEach(function (r) {
    if (!r.ok) bad++;
    console.log("[unit] " + (r.ok ? "ok   " : "BAD  ") + r.name + (r.ok ? "" : "  -> " + r.detail));
  });
  console.log("[unit] " + results.length + " checks, " + bad + " problem(s)");
  process.exit(bad ? 1 : 0);
}

soleHostChecks();
qamModeChecks();
localeChecks();
cooperativeChecks();
stampChecks();
fakeRenderChecks();
gateChecks(report);
