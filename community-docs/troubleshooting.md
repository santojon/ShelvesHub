# Troubleshooting ShelvesHub

*[Leia em português](pt-BR/troubleshooting.md)*

Most issues come down to a **port conflict**, **another host on the same
machine**, a **Deck Shelves version that predates ShelvesHub**, or a
**collapsed Steam UI**. Nearly all are fixable from the config
file — `shelveshub.config.json`, installed next to the binary — or the editable
Configuration section of the ShelvesHub tab, without reinstalling.

## Nothing shows up after installing

Restart Steam **completely** — the actual client, not just the game.
ShelvesHub injects when it catches Steam on launch, so it needs a fresh start
to take effect the first time.

## The config file

Precedence per setting is **environment variable > config file > built-in
default**. Edit `shelveshub.config.json` (or point `SHELVES_CONFIG_FILE` at
another path) and restart the service. Every key is documented inline; remove a
key to fall back to its default.

## Port conflicts

**The local RPC port (60123) is already in use.** The log shows
`Failed to bind 127.0.0.1:60123`. Pick a free port — the injected runtime
picks it up automatically:

```json
{ "rpc_port": 60124 }
```

**Steam's debug port is wrong or unreachable.** The log shows repeated
`Connection refused` on `127.0.0.1:8080`. First make sure Steam's debugging is
enabled (`~/.steam/steam/.cef-enable-remote-debugging` exists and Steam was
fully restarted afterwards). If it listens elsewhere:

```json
{ "cef_port": 8081 }
```

## Another host on the same machine

ShelvesHub coexists with another plugin host — it never loads Deck Shelves
twice and adds only its own tab. If it grabbed a plugin the other host was
about to load, give the other host time to claim the interface first:

```json
{ "owner_settle_secs": 25 }
```

Full details in [coexistence.md](coexistence.md). What you get next to a
loader depends on the Deck Shelves version it runs — see the next section.

## Which Deck Shelves do you have? The 0.6.0 compatibility matrix

Next to a plugin loader, what ShelvesHub can do for you depends on **where
your Deck Shelves came from and how old it is**. The loader's store still
lists Deck Shelves **2.0.0** (released 2026-04-30) while **3.3.4** is the
current release, so a copy installed from the store is far older than the
versions ShelvesHub 0.6.0 was built with. Find your Deck Shelves version in
the ShelvesHub tab (**View status** in Troubleshooting → *Deck Shelves version*) or in the loader's
plugin list, pick your row below, then read the column for your
`force_owner` / `coop_bundle` setting — both are off unless you turned them
on (`force_owner` can be flipped in the tab's Configuration section where a
loader is possible; `coop_bundle` lives in `shelveshub.config.json` only).

### How the hub decides

Three small signals inside Steam's interface settle who hosts the shelves:

- **The owner claim.** The first Deck Shelves copy to start writes its name
  on the interface. Deck Shelves 3.2.0 and newer do this; 3.3.1 and newer
  also write their version, which is what the ShelvesHub tab shows. A copy
  older than 3.2.0 — the store's 2.0.0 included — writes nothing. The hub
  only finds such a copy in the loader's plugin list and treats it as a
  **legacy copy**: it adds its own tab and never starts a second copy next
  to it, because two copies would mount the Home twice and collapse the
  Steam interface.
- **The force stamp** (`force_owner`). The hub marks the interface as owned
  by ShelvesHub before Deck Shelves starts, and a copy that starts after the
  stamp (3.3.0 and newer) binds to the hub instead of the loader. At a normal
  Steam start the loader starts its copy well before the hub's first look —
  about 15 seconds earlier on a Steam Deck — so the stamp usually comes too
  late. On its own, force rarely changes who hosts.
- **The offer** (`coop_bundle`, needs `force_owner`). The hub leaves a
  standing note in Steam's storage saying which Deck Shelves version it
  carries. A loader copy that is 3.4.0 or newer reads it at its next start
  and, if the hub's copy is at least as new, stands down: its entry in the
  loader's panel becomes a short note (*Deck Shelves runs from the ShelvesHub
  tab on this device.*) and the hub runs — and updates — its own copy. If the
  hub's copy does not show up within a minute, the loader's copy starts
  itself and the running hub stops asking for a day (a hub that was
  stopped, restarted or updated asks again at once).

With no loader on the machine none of this matters: the hub is the only host
and simply hosts.

### The matrix at a glance

| Your situation | Defaults (`force_owner` off, `coop_bundle` off) | `force_owner` on | `force_owner` + `coop_bundle` on |
|---|---|---|---|
| **No loader** — macOS, Windows, desktop Linux, SteamOS without a plugin loader | The hub hosts. Tab with the editor. Updates from the hub. | The same, after a 20 s wait for a loader that never comes; the Home may appear late. Turn it off. | As force; the offer is written for nobody. Turn both off. |
| **A loader with no Deck Shelves** | The hub hosts its own copy beside the loader at once. Tab with the editor. Updates from the hub. Status says `cooperative`. | The same. | The same. |
| **A loader with Deck Shelves 2.0.0** (the store's copy, or anything older than 3.2.0) | The loader hosts. The hub's tab shows the hub view only, no editor. Updates from the loader. Log: *legacy copy*. | The loader still hosts; the old copy ignores the hub. Status may claim the hub hosts. Turn it off and update. | As force, and the hub keeps updating a copy that never runs. Turn both off, or update the plugin. |
| **3.2.x** | The loader hosts. Hub view only. Status warns *predates the coexistence protocol*. Updates from the loader. | At a normal start, the same. A plugin reload under force makes the old copy stand down: no shelves until Steam restarts. Turn it off. | As force; the hub updates an unused copy. Turn both off, or update. |
| **3.3.0** | The loader hosts. Editor inside the hub's tab. Status warns *predates the coexistence protocol* (no version). Updates from the loader. | Plain coexistence labelled `cooperative`; a reload while the hub runs binds the copy to the hub. Prefer the defaults. | As force; no hand-over in this version, the hub updates an unused copy. |
| **3.3.1 – 3.3.4** | The loader hosts. Editor in the hub's tab, version shown, no warning. Updates from the loader. | Cooperative: the loader's copy binds to ShelvesHub (Status `cooperative` / *ShelvesHub (this host)*), the hub keeps to its tab, updates stay with the loader — measured on a Deck at a cold start and after a loader restart. Nothing gained over the defaults without `coop_bundle`. | Coexistence at a normal start. 3.3.4 hands over only when the plugin reloads with the hub already there; 3.3.1–3.3.3 never do. The hub keeps its own copy updated meanwhile. Update to 3.4.0. |
| **3.4.0 and newer** | As 3.3.1 – 3.3.4. | As 3.3.1 – 3.3.4; any old offer is withdrawn. | The hub hosts its own copy from the next Steam start; the loader's entry becomes a note; updates from the hub. The supported way to have the hub host next to a loader. |

### The cells in detail

Each block gives what you see, what can go wrong, and the fix with its
alternative. "The tab" is the ShelvesHub tab in the Quick Access Menu;
"Status" is the side panel's Status tab, opened by **View status** in Troubleshooting or Ctrl+Shift+T (*Ownership mode*, *Hosted by*, *Deck Shelves
version*); "the hub view" is the hub's own panel, shown when no editor is
available.

#### No loader (macOS, Windows, desktop Linux, SteamOS without a loader)

**Defaults.** The hub hosts the shelves itself. The tab opens on the Deck
Shelves editor with a pinned **ShelvesHub** button; Status reads `sole` /
*ShelvesHub (this host)* / the version. The Updates section has every
switch, **Download the latest Deck Shelves**, **Update ShelvesHub** and,
after an update, the **Go back to the previous …** rows. Log:
`Bundle not detected — injecting.`, then `Bundle active in renderer.` On
SteamOS / Linux the shipped config first waits 25 s for a loader
(`Renderer unclaimed — settling up to 25s …`); set `"owner_settle_secs": 0`
when there is none.

- *No shelves and no tab:* Steam's debugging port is not reachable. Run
  `shelveshub doctor` (`--fix` creates the flag file) and restart Steam
  fully.
- *The tab says the Deck Shelves bundle could not be brought up on this
  host:* the plugin failed to load. Tap **Download the latest Deck Shelves**,
  or **Go back to the previous Deck Shelves** if it broke right after an
  update.
- *The shelves work but the tab is missing:* `native_qam` is off, or the
  tab's crash guard tripped — see "The native tab" below.
- *Shelves only in Big Picture:* that is the default; `desktop_ui` is the
  experimental switch for the plain desktop client.

**`force_owner` on.** There is nothing to force. The hub waits at least 20 s
for a loader (`Forced ownership — waiting up to 20s for a plugin loader
before hosting.`), then hosts with the stamp set — and on a Mac that stamp
has made the Home shelves appear only after the Quick Access Menu was
opened. Fix: set `force_owner` to `false` (and `owner_settle_secs` to `0`),
restart the service.

**`force_owner` + `coop_bundle`.** As above; the offer is written every
cycle for a loader copy that does not exist. Fix: turn both off.

#### A loader with no Deck Shelves in it

**All three settings behave the same.** The hub sees that the loader has no
Deck Shelves (nothing in its plugin list, nothing in its plugins folder) and
hosts its own copy beside it right away, with no wait: `Plugin loader
present without Deck Shelves of its own — hosting our copy beside it.`, then
`Bundle active in renderer.` The tab shows the editor; Status reads
`cooperative` (the hub borrows the loader's interface pieces) / *ShelvesHub
(this host)*; updates come from the hub; the loader keeps its other plugins.

- *You later install Deck Shelves into the loader:* the install restarts
  Steam's interface, the loader's copy claims first and the hub steps back to
  its tab (`Coexisting with "…"`). The shelves now come from the loader's
  copy — read the row for that version. If the install does not restart the
  interface, Status keeps saying the hub hosts until the next Steam restart;
  cosmetic.
- *A Deck Shelves sits in the loader's folder but never loads* (disabled,
  broken, half installed): the hub sees it installed, waits for a claim that
  never comes, and may end up with a copy that never shows. Fix: remove or
  repair that copy in the loader, then restart Steam. Alternative: install a
  current Deck Shelves there and let the loader host.

#### Deck Shelves 2.0.0 — the store's copy (and anything older than 3.2.0)

**Defaults.** The loader hosts the shelves exactly as before ShelvesHub was
installed. The hub finds the copy only in the loader's plugin list, so the
log reads `Coexisting with "plugin loader (Deck Shelves 2.0.0, no ownership
claim — update it for full coexistence)" — native QAM tab added alongside
(host untouched).` (a plain `Coexisting with "…"` line follows once the
hub's tab is in). The tab shows the hub view only — this version cannot
share its editor into it — with Status `coexist` / the loader's name
*(plugin loader)* / version `—`, and the amber note *This Deck Shelves
predates the coexistence protocol — update it so both hosts can coexist
cleanly.* The Updates section says *Updates are managed by the plugin loader
here.* and shows only the hub's own switches. Settings live in the loader's
folder only (mirroring into the shared folder began in 3.3.0). With
`native_qam` off the hub adds nothing and logs `Renderer owned by "plugin
loader (…)" — standing down.`

- Nothing is broken in this state, but you get none of the integration: no
  editor in the tab, no shared settings, no hub updates for the plugin.
- *Fix:* update Deck Shelves from its
  [releases page](https://github.com/santojon/Deck-Shelves/releases) — the
  release zip, through the loader's install-from-zip or install-from-URL
  option — not from the store, which has nothing newer. *Alternative:*
  remove the loader's copy and restart Steam; the hub then hosts its own,
  current copy. Export your settings first (Deck Shelves settings → Backup →
  Full settings → Export) and import them afterwards: a copy this old never
  wrote to the shared settings folder.

**`force_owner` on.** The force stamp is for copies that know the hub; 2.0.0
does not, so the loader's copy keeps drawing the shelves. The hub still
injects its cooperative runtime and may write its own name on the interface,
so Status can read `cooperative` / *ShelvesHub (this host)* while the shelves
are the loader's — misleading, nothing more. If the hub later gives force up
(after repeated conflicts, or a restart with force off), the log shows
`claimed under an earlier forced ownership — coexisting only`. Fix: turn
`force_owner` off, then update as above.

**`force_owner` + `coop_bundle`.** As above, plus the hub downloads and
updates its own Deck Shelves that never runs (the offer is read by 3.4.0 or
newer only), and the Updates section shows the full rows acting on that
unused copy: a *Deck Shelves updated to …* notice changes nothing on screen.
Fix: turn both off, or update the plugin to 3.4.0 and restart Steam.

#### Deck Shelves 3.2.x

**Defaults.** The loader's copy claims the interface at start, so the hub
coexists normally: `Coexisting with "…" — native QAM tab added alongside
(host untouched).` The tab still shows the hub view only (the editor bridge
arrived in 3.3.0); Status reads `coexist` / the loader's name *(plugin
loader)* / `—` with the amber *predates the coexistence protocol* note,
because this version writes no version. Updates from the loader. Settings:
the loader's folder only.

- *Fix:* update from the releases page — 3.3.0 or newer puts the editor in
  the tab, 3.3.1 or newer removes the warning. *Alternative:* remove the
  loader's copy (export your settings first) and let the hub host.

**`force_owner` on.** At a normal Steam start nothing changes: the copy
starts before the stamp. But a copy of this version that starts *after* the
stamp — the loader reloading the plugin, or a plugin update through the
loader while the hub runs — writes the hub's name as owner and then stands
itself down: **no shelves until Steam restarts**, and the hub does not host
either. Fix: turn `force_owner` off. Alternative: update to 3.3.0 or newer,
which binds to the hub instead of standing down.

**`force_owner` + `coop_bundle`.** As force; this version has no hand-over,
so the hub updates a copy that never runs. Turn both off, or update to
3.4.0.

#### Deck Shelves 3.3.0

**Defaults.** Coexistence with the editor inside the hub's tab: the tab
opens on the Deck Shelves editor with the pinned **ShelvesHub** button;
Status reads `coexist` / the loader's name *(plugin loader)* / `—` plus the
amber *predates the coexistence protocol* note (3.3.0 claims but writes no
version). Updates from the loader. From this version on, settings are
mirrored between the loader's folder and the shared folder, so switching
hosts later keeps them.

- *Fix for the warning:* update to 3.3.1 or newer.

**`force_owner` on.** Plain coexistence in practice, labelled `cooperative`
in Status, because the loader's copy claims first. A copy that starts while
the hub's host is already there (a plugin reload) is meant to bind to the
hub — Status then reads *ShelvesHub (this host)* and updates stay with the
loader — but that path is the least exercised one. Repeated conflicts make
the hub give force up for the session (*Cooperative mode paused — it kept
conflicting with the plugin loader; running as coexistence this session.*).
Prefer the defaults.

**`force_owner` + `coop_bundle`.** As force; 3.3.0 has no hand-over, so the
hub updates its own unused copy and the Updates section acts on it. Turn
`coop_bundle` off, or update to 3.4.0.

#### Deck Shelves 3.3.1 – 3.3.4

**Defaults.** The intended coexistence: `Coexisting with "…" — native QAM
tab added alongside (host untouched).`; the editor in the hub's tab; Status
`coexist` / the loader's name *(plugin loader)* / the version, no warning;
*Updates are managed by the plugin loader here.* (the hub still updates
itself); settings shared between the two folders.

**`force_owner` on.** Cooperative: the hub stamps its preference as soon as
Steam's windows exist, and the loader's copy — booting a few seconds later —
claims the renderer for ShelvesHub: Status `cooperative` / *ShelvesHub (this
host)* / the version, log `Coexisting with "shelveshub" — native QAM tab added
alongside (host untouched).` The hub keeps to its tab and never loads a second
copy; updates stay with the loader. Seen on a Deck at a cold start and again
after a loader restart (2026-10-14). Repeated conflicts pause force for the
session (*Cooperative mode paused …*). Nothing is gained over the defaults
unless you add `coop_bundle` with 3.4.0.

**`force_owner` + `coop_bundle`.** At a normal start: coexistence, labelled
`cooperative`. The hand-over exists only in 3.3.4 and only through a live
handshake, so it engages when the plugin loads while the hub's host is
already there (a plugin reload): the loader's entry goes blank and the hub
hosts its own copy (`Cooperative bundle: the loader's copy stood down —
hosting our own copy.`). 3.3.1 – 3.3.3 never hand over. Meanwhile the hub
keeps its own copy downloaded and updated and the Updates section shows the
full rows for that copy, so a *Deck Shelves updated to …* notice may not
match the version on screen. Fix: update to 3.4.0; it can take one more
Steam restart, because the loader's copy only stands down for a hub copy at
least as new as itself. Alternative: turn `coop_bundle` off.

#### Deck Shelves 3.4.0 and newer

**Defaults, and `force_owner` alone:** as 3.3.1 – 3.3.4. With `coop_bundle`
off the hub also removes any old offer (`Cooperative bundle off — offer
withdrawn from the loader's copy.`), so the loader's copy runs at the next
start.

**`force_owner` + `coop_bundle`.** The supported way to have the hub host
next to a loader. Log, in order: `Cooperative bundle <version> offered to the
loader's copy — it stands down at its next boot.`; after the next Steam
start, `Cooperative bundle: the loader's copy stood down — hosting our own
copy.` and `Bundle active in renderer.` The loader's Deck Shelves entry shows
*Deck Shelves runs from the ShelvesHub tab on this device.*; the hub's tab
has the editor; Status reads `cooperative` / *ShelvesHub (this host)* / the
version; updates — and the **Go back to the previous Deck Shelves** row —
come from the hub. The shelves appear when the hub's first injection lands,
about 25 s after a restart on a Steam Deck. Keep `interval_secs` at 45 or
below.

- *The shelves came from the loader again and the log says* `Cooperative
  bundle: the loader's copy booted itself last time (ours did not land
  within its window) — not offering again for a day.`: the running hub was
  late (a long `interval_secs`, a slow start), the loader's copy gave up
  after a minute, and this hub process now holds the offer for 24 hours. A
  fallback from while the service was stopped no longer counts: restarting
  the service offers again, and the next Steam start brings the hub's copy
  back. Fix: keep `interval_secs` at 45 or less and restart the service. Alternative: set `coop_bundle` to `false`, restart the service (that
  withdraws the held offer), set it back to `true`, restart the service, and
  restart Steam.
- *The loader's copy is newer than the hub's:* it ignores the offer. With
  automatic updates on the hub logs `The loader's Deck Shelves <version> is
  newer than our copy (<version>) — checking for an update now.` and the
  next start's offer carries the newer version. Fix: one more Steam restart,
  or tap **Download the latest Deck Shelves** in the tab first.
- *Status shows "Cooperative mode paused …":* a collapse while forced, or
  the plugin's own tab tripping twice, made the hub stand force down for the
  session. Restart Steam; if it repeats, go back to the defaults and open an
  issue.
- *You want the loader's copy back:* set `coop_bundle` to `false`, restart
  the service, restart Steam.

### Fixes, in order

1. **Update Deck Shelves from its
   [releases page](https://github.com/santojon/Deck-Shelves/releases), not
   from the loader's store.** The store's 2.0.0 predates everything above;
   the release zip installs through the loader's install-from-zip or
   install-from-URL option. 3.3.1 or newer gives the full coexistence, 3.4.0
   or newer the cooperative bundle.
2. **Turn `force_owner` off** unless you also run `coop_bundle` with 3.4.0 or
   newer (the installer's cooperative-hosting question is what turns it on).
   On its own it never makes the hub host next to a loader, and it can make a
   3.2.x copy stand down or trip the safe mode.
3. **`coop_bundle` on or off** — in `shelveshub.config.json`. On (with
   `force_owner`) to let the hub run and update Deck Shelves beside the
   loader — 3.4.0 or newer only. Off to hand the shelves back to the loader's
   copy at the next Steam start.
4. **Remove the loader's copy to let the hub host.** The hub then hosts its
   own, current copy beside the loader. Export your settings first on copies
   older than 3.3.0.
5. **Go back a version** — Updates section, **Go back to the previous Deck
   Shelves** / **Go back to the previous ShelvesHub** (tap twice). The
   version you left is held back from automatic updates until a newer one is
   published or you update by hand.
6. **Restart the service** — `systemctl --user restart shelveshub` on
   SteamOS / Linux; the tray's **Restart service** where the tray is
   installed; or change the setting in the tab's Configuration section and
   tap **Restart to apply** twice, which restarts the service and Steam
   together. Config edits apply at the next service start; a change of who
   hosts also needs Steam restarted.
7. **Reset or restore settings** — Deck Shelves' own Backup card (Full
   settings → Export / Import) and **Reset everything** in its settings. The
   shared settings folder (`~/.local/share/deck-shelves` on SteamOS / Linux,
   `~/Library/Application Support/deck-shelves` on macOS,
   `%APPDATA%\deck-shelves` on Windows) keeps `settings.json`, a `.bak` and a
   `backups/` folder you can restore by hand with the service stopped.
   Uninstalling ShelvesHub keeps that folder.
8. **Open an issue** when a row's fix does not give you its cell: at
   [ShelvesHub](https://github.com/santojon/ShelvesHub/issues) for hosting,
   tab and update problems, at
   [Deck Shelves](https://github.com/santojon/Deck-Shelves/issues) for the
   shelves themselves. Attach the output of `shelveshub status --report`,
   the log lines containing `Coexisting with`, `Bundle active`,
   `Cooperative bundle` or `standing down`, the Deck Shelves version from
   Status, your `force_owner` / `coop_bundle` values, and what the loader's
   plugin list says.

### Quick checks

1. **Where the log is.** SteamOS and every other Linux, ARM64 included (one
   systemd user service): `journalctl --user -u shelveshub -f` (it survives an uninstall; `journalctl --user -u shelveshub -n 500
   --no-pager > ~/shelveshub.log` for a report). macOS:
   `~/.local/share/shelveshub/logs/out.log` (errors in `error.log` next to
   it). Windows: `%LOCALAPPDATA%\ShelvesHub\logs\out.log` (the previous
   file is kept as `out.log.1`). The tab's **View logs** merges the service
   and the injected runtime; the files and the journal hold the service side
   only.
2. **Read Status in the side panel** (**View status** in Troubleshooting, or Ctrl+Shift+T). *Ownership mode*: `sole` (no loader),
   `coexist` (the loader's copy hosts), `cooperative` (the hub's host is in
   place next to a loader, including the loader-without-Deck-Shelves case).
   *Hosted by*: *ShelvesHub (this host)*, or the loader's name *(plugin
   loader)*. *Deck Shelves version*: `—` means a copy older than 3.3.1. An
   amber line below is the legacy-copy warning or the paused-force notice.
3. **Three log lines tell the story.** `Bundle active in renderer.` — the
   hub hosts. `Coexisting with "…"` — the loader hosts; a `plugin loader
   (Deck Shelves <version>, …)` label inside the quotes means a legacy copy or
   a stale forced claim. `Cooperative bundle …` — the hand-over, its hold or
   its withdrawal. A line is written only when the state changes, so scroll
   up.
4. **`shelveshub status --report`** —
   `~/.local/share/shelveshub/shelveshub status --report`, on Windows
   `%LOCALAPPDATA%\ShelvesHub\shelveshub.exe status --report` — prints a JSON
   report (versions, OS, architecture, device) to paste into an issue.
   **`shelveshub doctor`** checks Steam's debug flag and port, the running
   Steam, the hub's control port and the service; `--fix` creates the flag
   file.
5. **The loader's plugin list** shows the Deck Shelves version the loader
   runs. If it says 2.0.0, start with fix 1.
6. **Config edits take effect at the next service start**; a change of who
   hosts needs Steam restarted too. The tab's **Restart to apply** does both.

## Black screen / collapsed Steam UI

If the Steam UI ever collapses, ShelvesHub **pauses injection** — it never
force-restarts Steam, which only makes it worse — and, on a confirmed black
screen, runs the **official recovery** for your platform by default (restarting the
Deck's Game Mode session, or bringing Steam back into Big Picture on desktop) — no
setup needed. You can override it with a custom command:

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

…or disable auto-recovery (pause only) with `off`:

```json
{ "recover_cmd": "off" }
```

## Turn the host off without uninstalling

The ShelvesHub tab has a **disable until restart** switch — it stands the host
down until the next service restart, without removing anything. Useful for
isolating whether ShelvesHub is involved in a problem.

## The native tab

The native Quick Access tab is controlled by `native_qam` (or
`SHELVES_NATIVE_QAM=1`). Set it to `false` to fall back to the on-screen panel.

## Reading the log

The merged log lives in the ShelvesHub tab's log viewer. From a terminal on
SteamOS / Linux:

```bash
journalctl --user -u shelveshub -f
```

The `journalctl` line covers every Linux — SteamOS, a desktop distribution or
an ARM64 board run the same systemd user service. On macOS the same lines go
to `~/.local/share/shelveshub/logs/out.log`; on Windows to `%LOCALAPPDATA%\ShelvesHub\logs\out.log` (rotated to `out.log.1`
once it passes 1 MiB). The tab's log viewer (**View logs**) shows them too.

Every error path writes a log line, so the log is the first place to look —
and the best thing to attach to a bug report.
