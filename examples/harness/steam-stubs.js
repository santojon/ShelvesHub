// examples/harness/steam-stubs.js — approximates the Steam CEF environment the Deck Shelves bundle
// sees, so the example bundle runs in plain Chromium (loaded before the bundle). Provides a minimal
// window.SteamClient and a window.__SHELVES_HOST__ stand-in whose rpc.call hits the real host RPC.

(function () {
  "use strict";

  const RPC_ENDPOINT = "http://127.0.0.1:60123";
  const HOST_API_VERSION = "1.0.0";

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
  const mountHandlers = [];
  const unmountHandlers = [];

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
