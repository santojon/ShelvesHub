// Contract version follows semver. Changes are additive-only after 1.0.0.
// 1.1.0 — added the `qam` namespace (Quick Access Menu panels), additive.
export const HOST_API_VERSION = "1.1.0";

export interface LifecycleApi {
  /** Call once at bundle mount to register teardown handlers. */
  register(): void;
  onMount(handler: () => void): void;
  onUnmount(handler: () => void): void;
}

export interface RpcApi {
  /** JSON-RPC-style call into the Rust host process over the local TCP channel. */
  call<T = unknown>(method: string, args?: unknown): Promise<T>;
}

export interface RouteApi {
  addRoute(path: string, component: unknown): void;
  removeRoute(path: string): void;
}

export interface NotificationsApi {
  send(title: string, body: string, timeout?: number): void;
}

export interface PlatformApi {
  getOSVersion(): string;
  checkCompatibility(): boolean;
  /** Navigate the Steam UI to the store/library page for the given appId. */
  navigateToApp(appId: number): void;
}

/** A dedicated panel + icon shown in the Steam Quick Access Menu (QAM). */
export interface QamPanel {
  /** Stable identifier — re-registering with the same id replaces the panel. */
  id: string;
  /** Label shown for the panel (and as the icon's accessible name). */
  title: string;
  /** Inline SVG markup (or a data: URI) used as the QAM icon. */
  icon: string;
  /**
   * Render the panel body into the given container element. The container is
   * owned by the host; return an optional cleanup callback run on unregister
   * or teardown.
   */
  render(container: HTMLElement): void | (() => void);
}

export interface QamApi {
  /**
   * Register a dedicated panel with its own icon in the Quick Access Menu.
   * Returns an unregister function that removes the panel and icon.
   */
  registerPanel(panel: QamPanel): () => void;
}

/**
 * What the Shelves Loader host process provides to the Deck Shelves bundle.
 *
 * The bundle receives this object at startup (via `window.__SHELVES_HOST__`)
 * and uses it to register itself, invoke host methods, and manage routes.
 * UI components, rendering, and everything else are the bundle's own concern.
 */
export interface HostApi {
  readonly version: string;
  lifecycle: LifecycleApi;
  rpc: RpcApi;
  routes: RouteApi;
  notifications?: NotificationsApi;
  platform: PlatformApi;
  /** Quick Access Menu panels. Added in HostApi 1.1.0. */
  qam: QamApi;
}
