// examples/harness/steam-stubs.js
//
// Stubs that approximate the environment the Deck Shelves bundle sees inside
// the real Steam CEF renderer, so the example bundle can run in a plain local
// Chromium. Loaded by examples/harness/index.html BEFORE the bundle is injected.
//
// It provides two things:
//
//   1. window.SteamClient — a minimal subset of the Steam client API surface,
//      enough for the bundle to call without crashing.
//   2. window.__SHELVES_HOST__ — a local stand-in for the ShelvesHostApi the
//      loader will eventually inject (Set 4). Its `rpc.call` talks to the
//      real host RPC server over HTTP, mirroring src/runtime/host/shelves.ts,
//      so `ping` / `getVersion` / `isInjected` are answered for real when the
//      `loader` binary is running.

(function () {
  "use strict";

  var RPC_ENDPOINT = "http://127.0.0.1:60123";
  var HOST_API_VERSION = "1.0.0";

  // ── Minimal SteamClient stub ────────────────────────────────────────────
  window.SteamClient = window.SteamClient || {
    Apps: {
      RunGame: function (appId) {
        console.log("[steam-stub] SteamClient.Apps.RunGame", appId);
      },
    },
    Notifications: {
      DisplayNotification: function (title, body) {
        console.log("[steam-stub] Notification:", title, "-", body);
      },
    },
  };

  // ── Local ShelvesHostApi stand-in ───────────────────────────────────────
  var mountHandlers = [];
  var unmountHandlers = [];

  window.__SHELVES_HOST__ = {
    version: HOST_API_VERSION,
    lifecycle: {
      register: function () { console.log("[host-stub] lifecycle.register"); },
      onMount: function (h) { mountHandlers.push(h); h && h(); },
      onUnmount: function (h) { unmountHandlers.push(h); },
    },
    rpc: {
      call: function (method, args) {
        return fetch(RPC_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: method, args: args == null ? null : args }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("rpc.call(" + method + ") HTTP " + res.status);
            return res.json();
          })
          .then(function (json) {
            if (!json.ok) throw new Error("rpc.call(" + method + "): " + json.error);
            return json.result;
          });
      },
    },
    routes: {
      addRoute: function (path) { console.log("[host-stub] routes.addRoute", path); },
      removeRoute: function (path) { console.log("[host-stub] routes.removeRoute", path); },
    },
    notifications: {
      send: function (title, body) {
        window.SteamClient.Notifications.DisplayNotification(title, body);
      },
    },
    platform: {
      getOSVersion: function () { return navigator.userAgent; },
      checkCompatibility: function () { return true; },
      navigateToApp: function (appId) { window.SteamClient.Apps.RunGame(appId); },
    },
  };

  console.log("[steam-stub] environment ready (HostApi v" + HOST_API_VERSION + ")");
})();
