// examples/harness/orchestrate.js — drives one scenario end to end against the Steam mock.
// Reads window.__HARNESS__ (?scenario=: coexist / pluginPanel / lateMount / nativeUi / forceOwner /
// coopBundle / locale / tabSwitch), loads the runtime via a <script> tag, sets window.__HARNESS_READY__.

(function () {
  "use strict";
  const S = window.__HARNESS__ || {};

  function loadRuntime() {
    // Mirror the daemon: the runtime source is split across shelves-host.js and
    // its part files; fetch them in order, wrap in one strict IIFE, and inject —
    // exactly the form the daemon assembles on-device.
    const files = [
      "../../runtime/shelves-host.js",
      "../../runtime/shelves-host-qam.js",
      "../../runtime/shelves-host-api.js",
      "../../runtime/shelves-host-sidecar.js",
      "../../runtime/shelves-host-toast.js",
    ];
    return Promise.all(
      files.map(function (f) {
        return fetch(f).then(function (r) {
          if (!r.ok) throw new Error(f + " failed to load (" + r.status + ")");
          return r.text();
        });
      })
    ).then(function (bodies) {
      const s = document.createElement("script");
      s.textContent = '(function () {\n"use strict";\n' + bodies.join("\n") + "\n})();\n";
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
        unavailable_body: "The Deck Shelves bundle could not be brought up on this host.",
        action_download: "Download the latest Deck Shelves",
        action_update_hub: "Update ShelvesHub",
        action_logs: "View logs",
        action_status: "View status",
        action_auto_update: "Automatic updates",
      },
    };

    // A locale scenario reads the real shipped dictionary (the daemon inlines them all on-device).
    const dict = S.locale
      ? fetch("../../runtime/i18n/" + S.locale + ".json").then(function (r) { return r.json(); }).then(function (d) { window.__SHELVES_I18N__[S.locale] = d; })
      : Promise.resolve();

    // A coexisting plugin queues its panel BEFORE the runtime arrives, exercising
    // the order-independent __SHELVES_QAM_PENDING__ path (the runtime drains it).
    if (S.pluginPanel) window.__HARNESS_REGISTER_PLUGIN_PANEL__();

    let chain;
    if (S.lateMount) {
      // QAM already mounted when the runtime patches → native-arming; the
      // coexistence re-point should still land the tab on the next render.
      window.__HARNESS_MOUNT_QAM__();
      chain = dict.then(loadRuntime).then(function () {
        window.__HARNESS_RENDER__();
      });
    } else {
      // Runtime patches BEFORE the QAM first mounts → the tab lands on mount.
      chain = dict.then(loadRuntime).then(function () {
        window.__HARNESS_MOUNT_QAM__();
      });
    }
    return chain;
  }

  /* Native discovery runs OFF the render path (a settle timer, then a chunked
     scan yielding between steps), so native components land after the QAM mounts.
     For native scenarios, wait for that discovery — and, with a plugin panel
     registered, for the hub button's native render — before signalling ready. */
  function waitForNativeRender() {
    return new Promise(function (resolve) {
      const t0 = Date.now();
      (function poll() {
        let n = null;
        try { n = window.__HARNESS_REPORT__().nativeUi; } catch (e) {}
        const landed = !!(n && n.discovered && (n.rendered || !S.pluginPanel));
        if (landed || Date.now() - t0 > 4000) return resolve();
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
