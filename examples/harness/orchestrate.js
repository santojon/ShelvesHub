// examples/harness/orchestrate.js
//
// Drives one scenario end to end against the Steam mock, in the order that
// matters. Reads window.__HARNESS__ (set by the page from ?scenario=):
//
//   coexist     — a foreign loader (DFL) is present (mock installs it)
//   pluginPanel — a coexisting plugin registers a QAM panel (mirroring)
//   lateMount   — mount the QAM BEFORE the runtime loads (native-arming path)
//
// Loads runtime/shelves-host.js via a <script> tag so the file:// path needs no
// extra browser flags. Sets window.__HARNESS_READY__ when the scenario is fully
// wired, so the runner knows the report is stable.

(function () {
  "use strict";
  var S = window.__HARNESS__ || {};

  function loadRuntime() {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "../../runtime/shelves-host.js";
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("runtime/shelves-host.js failed to load"));
      };
      document.head.appendChild(s);
    });
  }

  function run() {
    // Opt into the native tab (what SHELVES_NATIVE_QAM=1 stamps on-device).
    window.__SHELVES_NATIVE_QAM__ = true;

    // The dictionaries the daemon inlines on-device, so the fallback panel reads
    // real strings (mirror of runtime/i18n/en-US.json).
    window.__SHELVES_I18N__ = window.__SHELVES_I18N__ || {
      "en-US": {
        hub_title: "ShelvesHub",
        panel_error: "Deck Shelves: could not render the panel.",
        unavailable_title: "Deck Shelves is not loaded",
        unavailable_body: "The Deck Shelves bundle could not be brought up on this host.",
        action_download: "Download the latest Deck Shelves",
        action_update_hub: "Update ShelvesHub",
        action_logs: "View logs",
        action_auto_update: "Automatic updates",
      },
    };

    // A coexisting plugin queues its panel BEFORE the runtime arrives, exercising
    // the order-independent __SHELVES_QAM_PENDING__ path (the runtime drains it).
    if (S.pluginPanel) window.__HARNESS_REGISTER_PLUGIN_PANEL__();

    var chain;
    if (S.lateMount) {
      // QAM already mounted when the runtime patches → native-arming; the
      // coexistence re-point should still land the tab on the next render.
      window.__HARNESS_MOUNT_QAM__();
      chain = loadRuntime().then(function () {
        window.__HARNESS_RENDER__();
      });
    } else {
      // Runtime patches BEFORE the QAM first mounts → the tab lands on mount.
      chain = loadRuntime().then(function () {
        window.__HARNESS_MOUNT_QAM__();
      });
    }
    return chain;
  }

  // Native discovery runs OFF the render path (a settle timer, then a chunked
  // scan yielding between steps), so native components land after the QAM mounts.
  // For native scenarios, wait for that render before signalling ready.
  function waitForNativeRender() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var r = null;
        try { r = window.__HARNESS_REPORT__(); } catch (e) {}
        if ((r && r.nativeUi) || Date.now() - t0 > 4000) return resolve();
        setTimeout(poll, 80);
      })();
    });
  }

  function start() {
    run()
      .then(function () {
        return window.__HARNESS__ && window.__HARNESS__.nativeUi ? waitForNativeRender() : null;
      })
      .then(function () {
        window.__HARNESS_READY__ = true;
      })
      .catch(function (e) {
        window.__HARNESS_ERROR__ = String((e && e.stack) || e);
        window.__HARNESS_READY__ = true;
      });
  }

  // Wait for <body> (and #root) — the late-mount path renders synchronously, so
  // the DOM must exist before the first mount.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
