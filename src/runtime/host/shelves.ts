// ShelvesHostApi — the ShelvesHub implementation of HostApi.
//
// Injected into the Steam renderer as `window.__SHELVES_HOST__` so the
// Deck Shelves bundle can call host services without knowing how they
// are implemented underneath.

import type {
  HostApi,
  LifecycleApi,
  NotificationsApi,
  PlatformApi,
  QamApi,
  RouteApi,
  RpcApi,
} from "./contract";
import { HOST_API_VERSION } from "./contract";

const RPC_ENDPOINT = "http://127.0.0.1:60123";

function notImplemented(ns: string, method: string): never {
  throw new Error(`[ShelvesHostApi] ${ns}.${method}: not implemented`);
}

const lifecycle: LifecycleApi = {
  register() { notImplemented("lifecycle", "register"); },
  onMount(_handler) { notImplemented("lifecycle", "onMount"); },
  onUnmount(_handler) { notImplemented("lifecycle", "onUnmount"); },
};

const rpc: RpcApi = {
  async call<T = unknown>(method: string, args?: unknown): Promise<T> {
    const res = await fetch(RPC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, args: args ?? null }),
    });
    if (!res.ok) {
      throw new Error(`[ShelvesHostApi] rpc.call(${method}) HTTP ${res.status}`);
    }
    const json = await res.json() as { ok: boolean; result?: T; error?: string };
    if (!json.ok) {
      throw new Error(`[ShelvesHostApi] rpc.call(${method}): ${json.error}`);
    }
    return json.result as T;
  },
};

const routes: RouteApi = {
  addRoute(_path, _component) { notImplemented("routes", "addRoute"); },
  removeRoute(_path) { notImplemented("routes", "removeRoute"); },
};

const notifications: NotificationsApi = {
  send(_title, _body, _timeout) { notImplemented("notifications", "send"); },
};

const platform: PlatformApi = {
  getOSVersion() {
    return navigator.userAgent;
  },
  checkCompatibility() {
    return typeof window !== "undefined";
  },
  navigateToApp(_appId) { notImplemented("platform", "navigateToApp"); },
};

// The concrete QAM implementation lives in the injected host runtime
// (`runtime/shelves-host.js`), which is what the loader exposes as
// `window.__SHELVES_HOST__`. This stub documents the contract surface.
const qam: QamApi = {
  registerPanel(_panel) { return notImplemented("qam", "registerPanel"); },
};

export const ShelvesHostApi: HostApi = {
  version: HOST_API_VERSION,
  lifecycle,
  rpc,
  routes,
  notifications,
  platform,
  qam,
};
