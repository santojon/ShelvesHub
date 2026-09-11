//! Bundle "populate" — obtain the Deck Shelves bundle when it isn't already
//! present locally, so the sole-host case (no plugin loader, no local bundle)
//! can still bring Deck Shelves up on its own.
//!
//! The daemon injects the bundle with `Runtime.evaluate` (as a script), so it
//! needs the self-executing **IIFE** (`index.iife.js`), not the ES `index.js`.
//!
//! Resolution order:
//!   1. **local** — the configured bundle path, if it holds a real bundle (not
//!      the tiny placeholder shipped in the package).
//!   2. **copy from a loader** — a plugin loader keeps its built copy at
//!      `~/homebrew/plugins/deck-shelves/dist/index.iife.js`; copy it if present.
//!   3. **download** — fetch the newest `*.iife.js` asset from the Deck Shelves
//!      GitHub releases (via `curl`, so no HTTP/TLS crate is pulled in).
//!
//! Everything here is best-effort: on failure the caller keeps whatever is at
//! the path and injection reports the miss — it never panics.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::logger::{log_error, log_info};

/// A file below this size is treated as absent/placeholder rather than a real
/// bundle. The shipped placeholder is ~68 bytes; a real Deck Shelves IIFE is
/// multiple megabytes, so any small file (placeholder or a truncated download)
/// falls through to the next source.
const REAL_BUNDLE_MIN_BYTES: u64 = 4096;

/// A plugin loader's install path of the injectable artifact, relative to `$HOME`.
/// (Note: a loader *release* `.zip` currently excludes the IIFE — only a dev deploy
/// that copies the whole `dist/` has it — so step 3 is the reliable path for end
/// users once the plugin publishes the IIFE as a release asset.)
const LOADER_IIFE_REL: &str = "homebrew/plugins/deck-shelves/dist/index.iife.js";

/// GitHub API for the newest stable Deck Shelves release. Unauthenticated (60
/// req/h) — fine for an occasional populate.
const RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/santojon/Deck-Shelves/releases/latest";

/// GitHub API listing all releases, newest first, INCLUDING pre-releases — used
/// when the pre-release channel is enabled (the plugin's beta channel equivalent).
const RELEASES_ALL_URL: &str = "https://api.github.com/repos/santojon/Deck-Shelves/releases";

/// ShelvesHub's OWN release endpoints (the hub self-update check reads these to
/// tell whether the running daemon is behind the newest hub release).
const HUB_RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/santojon/ShelvesHub/releases/latest";
const HUB_RELEASES_ALL_URL: &str = "https://api.github.com/repos/santojon/ShelvesHub/releases";

/// Ensure `dest` holds a real Deck Shelves bundle, obtaining it if needed.
/// `prerelease` widens the download step to pre-release releases. Returns a short
/// description of where the bundle came from, or an error message.
pub fn ensure_bundle(dest: &Path, prerelease: bool) -> Result<String, String> {
    // 1. Local.
    if is_real_bundle(dest) {
        return Ok(format!("local ({})", dest.display()));
    }

    // 2. Copy from an installed plugin loader.
    if let Some(src) = loader_iife_path() {
        if is_real_bundle(&src) {
            copy_into(&src, dest)?;
            log_info(
                "populate",
                &format!(
                    "Copied bundle from an existing loader install: {}",
                    src.display()
                ),
            );
            return Ok(format!(
                "copied from an existing loader install ({})",
                src.display()
            ));
        }
    }

    // 3. Download the newest IIFE from the releases.
    log_info(
        "populate",
        "No local bundle and no loader copy — downloading from Deck Shelves releases.",
    );
    let url = download_latest_iife(dest, prerelease)?;
    Ok(format!("downloaded ({url})"))
}

/// A plugin loader's install dir (holds `main.py` + `src/backend/`), relative to `$HOME`.
const LOADER_BACKEND_REL: &str = "homebrew/plugins/deck-shelves";

/// Ensure `dest` holds the Deck Shelves Python backend (`main.py` + `src/backend/`)
/// so a SOLE host (no plugin loader — e.g. macOS/Windows) has the data RPCs
/// (settings persistence, online wishlist/prices, launchers, device state, …), not
/// just local shelves. Same three-step strategy as `ensure_bundle`: keep an existing
/// copy → copy from an installed loader → download the release's backend archive.
/// Returns a short description or an error; callers treat failure as "data RPC off".
pub fn ensure_backend(dest: &Path, prerelease: bool) -> Result<String, String> {
    // 1. Already present.
    if dest.join("main.py").is_file() {
        return Ok(format!("local ({})", dest.display()));
    }
    // 2. Copy from an installed plugin loader (Linux/SteamOS with the loader).
    if let Some(src) = loader_backend_dir() {
        if src.join("main.py").is_file() {
            copy_backend_tree(&src, dest)?;
            log_info(
                "populate",
                &format!(
                    "Copied backend from an existing loader install: {}",
                    src.display()
                ),
            );
            return Ok(format!(
                "copied from an existing loader install ({})",
                src.display()
            ));
        }
    }
    // 3. Download + extract the release's backend archive.
    log_info(
        "populate",
        "No local backend and no loader copy — downloading from Deck Shelves releases.",
    );
    let url = download_latest_backend(dest, prerelease)?;
    Ok(format!("downloaded ({url})"))
}

/// The plugin's update preferences, read from `<settings_dir>/settings.json` (the
/// shared store the backend persists). The hub honors these for its OWN obtain/
/// update, on top of its own criteria (never overwrite a working bundle):
/// - `beta` (plugin `betaChannelEnabled`) selects pre-release downloads;
/// - `auto_update` (plugin `updateNotifyEnabled`) reflects the user opting into
///   automatic updates — false means "don't fetch a newer version over one that
///   already works" (the hub's existing keep-local criterion already enforces this
///   on boot; the initial obtain when absent still runs, since a host needs a bundle).
///
/// Defaults match the plugin schema: auto_update=true, beta=false.
pub struct PluginUpdatePrefs {
    pub auto_update: bool,
    pub beta: bool,
}

pub fn plugin_update_prefs(settings_dir: &Path) -> PluginUpdatePrefs {
    let default = PluginUpdatePrefs {
        auto_update: true,
        beta: false,
    };
    let Ok(text) = fs::read_to_string(settings_dir.join("settings.json")) else {
        return default;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return default;
    };
    PluginUpdatePrefs {
        auto_update: v
            .get("updateNotifyEnabled")
            .and_then(|b| b.as_bool())
            .unwrap_or(true),
        beta: v
            .get("betaChannelEnabled")
            .and_then(|b| b.as_bool())
            .unwrap_or(false),
    }
}

/// `$HOME/homebrew/plugins/deck-shelves`, if it exists.
fn loader_backend_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let p = Path::new(&home).join(LOADER_BACKEND_REL);
    p.is_dir().then_some(p)
}

/// Copy the backend files a sole host needs — `main.py` (at the root) plus the
/// `src/backend/` module tree it imports — from `src` into `dest`.
fn copy_backend_tree(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    copy_into(&src.join("main.py"), &dest.join("main.py"))?;
    let sb = src.join("src").join("backend");
    if sb.is_dir() {
        copy_dir_recursive(&sb, &dest.join("src").join("backend"))?;
    }
    Ok(())
}

/// Recursively copy a directory tree (stdlib only, so it works on every OS).
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            // Skip caches — never needed and can be large.
            if from.file_name().and_then(|n| n.to_str()) == Some("__pycache__") {
                continue;
            }
            copy_dir_recursive(&from, &to)?;
        } else {
            copy_into(&from, &to)?;
        }
    }
    Ok(())
}

/// Resolve the newest release's backend archive (`*backend*.tar.gz`) and extract it
/// into `dest`. Pre-release channel widens to pre-releases (newest overall).
fn download_latest_backend(dest: &Path, prerelease: bool) -> Result<String, String> {
    let url = if prerelease {
        let api = curl_text(RELEASES_ALL_URL)?;
        find_newest_backend_in_releases(&api).ok_or_else(|| {
            "no backend archive asset in any release (publish it there)".to_string()
        })?
    } else {
        let api = curl_text(RELEASES_LATEST_URL)?;
        find_backend_asset_url(&api).ok_or_else(|| {
            "no backend archive asset in the latest release (publish it there)".to_string()
        })?
    };
    extract_tgz_url(&url, dest)?;
    if !dest.join("main.py").is_file() {
        return Err(format!(
            "extracted archive has no main.py at {}",
            dest.display()
        ));
    }
    log_info("populate", &format!("Downloaded backend from {url}"));
    Ok(url)
}

/// The `browser_download_url` of the first backend archive asset in one release.
/// Matches a `.tar.gz` whose name contains "backend" (e.g. `deck-shelves-backend.tar.gz`).
fn backend_asset_url(release: &serde_json::Value) -> Option<String> {
    for asset in release.get("assets")?.as_array()? {
        let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let lower = name.to_ascii_lowercase();
        if lower.contains("backend") && (lower.ends_with(".tar.gz") || lower.ends_with(".tgz")) {
            return asset
                .get("browser_download_url")
                .and_then(|u| u.as_str())
                .map(str::to_owned);
        }
    }
    None
}

fn find_backend_asset_url(release_json: &str) -> Option<String> {
    let release: serde_json::Value = serde_json::from_str(release_json).ok()?;
    backend_asset_url(&release)
}

fn find_newest_backend_in_releases(releases_json: &str) -> Option<String> {
    let releases: serde_json::Value = serde_json::from_str(releases_json).ok()?;
    for release in releases.as_array()? {
        if let Some(url) = backend_asset_url(release) {
            return Some(url);
        }
    }
    None
}

/// Download a `.tar.gz` to a temp file and extract it into `dest` via the `tar` CLI
/// (present on macOS, Linux and Windows 10+). Best-effort, fail-soft on any error.
fn extract_tgz_url(url: &str, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let tmp = dest.join(".backend-download.tar.gz");
    curl_download(url, &tmp)?;
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&tmp)
        .arg("-C")
        .arg(dest)
        .status()
        .map_err(|e| format!("tar (is it installed?): {e}"))?;
    let _ = fs::remove_file(&tmp);
    if !status.success() {
        return Err(format!("tar exit {:?} extracting {url}", status.code()));
    }
    Ok(())
}

/// A file that exists and is larger than a placeholder.
fn is_real_bundle(p: &Path) -> bool {
    fs::metadata(p)
        .map(|m| m.is_file() && m.len() >= REAL_BUNDLE_MIN_BYTES)
        .unwrap_or(false)
}

/// `$HOME/homebrew/plugins/deck-shelves/dist/index.iife.js`, if it exists.
fn loader_iife_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let p = Path::new(&home).join(LOADER_IIFE_REL);
    p.exists().then_some(p)
}

fn copy_into(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    fs::copy(src, dest)
        .map(|_| ())
        .map_err(|e| format!("copy {} -> {}: {e}", src.display(), dest.display()))
}

/// Resolve the newest release's `*.iife.js` asset and download it to `dest`. When
/// `prerelease` is set, pre-release releases are considered (newest overall);
/// otherwise only the latest stable release.
fn download_latest_iife(dest: &Path, prerelease: bool) -> Result<String, String> {
    let url = if prerelease {
        let api = curl_text(RELEASES_ALL_URL)?;
        find_newest_iife_in_releases(&api)
            .ok_or_else(|| "no `*.iife.js` asset in any release (publish it there)".to_string())?
    } else {
        let api = curl_text(RELEASES_LATEST_URL)?;
        find_iife_asset_url(&api).ok_or_else(|| {
            "no `*.iife.js` asset in the latest release (publish it there)".to_string()
        })?
    };
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    curl_download(&url, dest)?;
    if !is_real_bundle(dest) {
        return Err(format!(
            "downloaded file at {} is too small",
            dest.display()
        ));
    }
    log_info("populate", &format!("Downloaded bundle from {url}"));
    Ok(url)
}

/// The `browser_download_url` of the first `*.iife.js` asset in one release object.
fn iife_asset_url(release: &serde_json::Value) -> Option<String> {
    for asset in release.get("assets")?.as_array()? {
        let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if name.ends_with(".iife.js") {
            return asset
                .get("browser_download_url")
                .and_then(|u| u.as_str())
                .map(str::to_owned);
        }
    }
    None
}

/// The `*.iife.js` asset URL of a single release JSON body (`releases/latest`).
fn find_iife_asset_url(release_json: &str) -> Option<String> {
    let release: serde_json::Value = serde_json::from_str(release_json).ok()?;
    iife_asset_url(&release)
}

/// The `tag_name` of the release the auto-update path WOULD install for this
/// channel — the latest stable release, or (prerelease) the newest non-draft
/// release carrying an `*.iife.js` asset, mirroring `download_latest_iife`'s
/// selection so the stored tag matches what gets installed. `None` on a network
/// or parse miss, which the caller treats as "no change" (never a spurious update).
pub fn latest_release_tag(prerelease: bool) -> Option<String> {
    if prerelease {
        newest_release_tag_in_releases(&curl_text(RELEASES_ALL_URL).ok()?)
    } else {
        release_tag(&serde_json::from_str(&curl_text(RELEASES_LATEST_URL).ok()?).ok()?)
    }
}

fn release_tag(release: &serde_json::Value) -> Option<String> {
    release
        .get("tag_name")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
}

fn newest_release_tag_in_releases(releases_json: &str) -> Option<String> {
    let releases: serde_json::Value = serde_json::from_str(releases_json).ok()?;
    for release in releases.as_array()? {
        if release.get("draft").and_then(serde_json::Value::as_bool) == Some(true) {
            continue; // never install from a draft
        }
        if iife_asset_url(release).is_some() {
            return release_tag(release);
        }
    }
    None
}

/// The `tag_name` of the newest ShelvesHub release for this channel — the hub
/// self-update check compares it to the running daemon's version. `None` on a
/// network/parse miss (treated as "no update").
pub fn latest_hub_release_tag(prerelease: bool) -> Option<String> {
    if prerelease {
        newest_hub_release_tag(&curl_text(HUB_RELEASES_ALL_URL).ok()?)
    } else {
        release_tag(&serde_json::from_str(&curl_text(HUB_RELEASES_LATEST_URL).ok()?).ok()?)
    }
}

fn newest_hub_release_tag(releases_json: &str) -> Option<String> {
    let releases: serde_json::Value = serde_json::from_str(releases_json).ok()?;
    for release in releases.as_array()? {
        if release.get("draft").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        if let Some(tag) = release_tag(release) {
            return Some(tag);
        }
    }
    None
}

/// The release-package asset names for the running OS, in priority order. Each
/// package ships the same binary for its platform (the SteamOS and desktop-Linux
/// packages carry the byte-identical x86_64 binary and differ only in installer
/// scripts, which self-update does not need), so any match works — the list is
/// just so a missing preferred asset falls back to the alternate.
fn hub_package_candidates() -> &'static [&'static str] {
    #[cfg(target_os = "macos")]
    {
        &["shelveshub-macos.tar.gz"]
    }
    #[cfg(target_os = "windows")]
    {
        &["shelveshub-windows.zip"]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Prefer the SteamOS package on the Deck; either yields the same binary.
        if is_steamos() {
            &["shelveshub-steamos.tar.gz", "shelveshub-linux.tar.gz"]
        } else {
            &["shelveshub-linux.tar.gz", "shelveshub-steamos.tar.gz"]
        }
    }
}

/// The binary file name inside a release package for this OS.
fn hub_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "shelveshub.exe"
    } else {
        "shelveshub"
    }
}

/// Best-effort SteamOS detection (the Deck), for choosing the preferred package.
#[cfg(all(unix, not(target_os = "macos")))]
fn is_steamos() -> bool {
    fs::read_to_string("/etc/os-release")
        .map(|s| s.to_lowercase().contains("steamos"))
        .unwrap_or(false)
}

/// The `browser_download_url` of the first asset in a release whose name matches
/// one of `names` (pure — tested without the network).
fn find_asset_url_by_names(release: &serde_json::Value, names: &[&str]) -> Option<String> {
    let assets = release.get("assets")?.as_array()?;
    for want in names {
        for asset in assets {
            if asset.get("name").and_then(serde_json::Value::as_str) == Some(*want) {
                if let Some(url) = asset
                    .get("browser_download_url")
                    .and_then(serde_json::Value::as_str)
                {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

/// Does the file head look like a native executable for the running OS? Guards
/// against staging a truncated/HTML error page over the daemon binary (pure).
fn looks_like_executable(head: &[u8]) -> bool {
    if cfg!(target_os = "windows") {
        head.starts_with(b"MZ") // PE / DOS stub
    } else if cfg!(target_os = "macos") {
        // Mach-O (either endianness) or a fat/universal binary.
        matches!(
            head,
            [0xFE, 0xED, 0xFA, 0xCE, ..]
                | [0xCE, 0xFA, 0xED, 0xFE, ..]
                | [0xFE, 0xED, 0xFA, 0xCF, ..]
                | [0xCF, 0xFA, 0xED, 0xFE, ..]
                | [0xCA, 0xFE, 0xBA, 0xBE, ..]
                | [0xBE, 0xBA, 0xFE, 0xCA, ..]
        )
    } else {
        head.starts_with(&[0x7F, b'E', b'L', b'F']) // ELF
    }
}

/// The newest ShelvesHub release object for the channel (whole JSON, so the tag
/// AND the asset list are available). `prerelease` widens to the beta channel.
fn latest_hub_release(prerelease: bool) -> Result<serde_json::Value, String> {
    if prerelease {
        let all: serde_json::Value = serde_json::from_str(&curl_text(HUB_RELEASES_ALL_URL)?)
            .map_err(|e| format!("parse releases: {e}"))?;
        all.as_array()
            .and_then(|rs| {
                rs.iter()
                    .find(|r| r.get("draft").and_then(serde_json::Value::as_bool) != Some(true))
                    .cloned()
            })
            .ok_or_else(|| "no published ShelvesHub release found".to_string())
    } else {
        serde_json::from_str(&curl_text(HUB_RELEASES_LATEST_URL)?)
            .map_err(|e| format!("parse release: {e}"))
    }
}

/// Extract `archive` into `dest` via `tar` (GNU tar for `.tar.gz`; bsdtar, present
/// on Windows 10+, transparently handles the `.zip` used there).
fn extract_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let name = archive.to_string_lossy().to_lowercase();
    let flag = if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        "-xzf"
    } else {
        "-xf"
    };
    let status = Command::new("tar")
        .arg(flag)
        .arg(archive)
        .arg("-C")
        .arg(dest)
        .status()
        .map_err(|e| format!("tar (is it installed?): {e}"))?;
    if !status.success() {
        return Err(format!(
            "tar exit {:?} extracting {}",
            status.code(),
            archive.display()
        ));
    }
    Ok(())
}

/// Put `new_bin` in place of the running executable at `exe`. A running binary
/// cannot be overwritten in place uniformly across OSes, so this stages the swap:
/// the change lands on disk now and the NEW binary runs after the next restart.
///  - Unix: write beside `exe` on the same filesystem, mark it executable, then
///    atomically `rename` over `exe` (the running process keeps its open inode).
///  - Windows: move the running `exe` aside to `*.old` (allowed while running),
///    then copy the new binary into `exe`; the stale `*.old` is cleaned up on the
///    next start.
fn stage_binary_swap(new_bin: &Path, exe: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let old = exe.with_extension("old");
        let _ = fs::remove_file(&old);
        fs::rename(exe, &old).map_err(|e| format!("move running exe aside: {e}"))?;
        if let Err(e) = copy_into(new_bin, exe) {
            let _ = fs::rename(&old, exe); // roll back so the service still runs
            return Err(e);
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let staged = exe.with_file_name(format!(
            "{}.new",
            exe.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("shelveshub")
        ));
        copy_into(new_bin, &staged)?;
        fs::set_permissions(&staged, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod staged binary: {e}"))?;
        fs::rename(&staged, exe).map_err(|e| {
            let _ = fs::remove_file(&staged);
            format!("replace running binary: {e}")
        })?;
        Ok(())
    }
}

/// Best-effort removal of leftover self-update artifacts beside the running
/// binary: an interrupted staged copy (`*.new`) on any OS, and the moved-aside
/// previous binary (`*.old`) on Windows (which could not be deleted while it was
/// the running process, but can be now). Never fails the daemon.
pub fn cleanup_stale_update_artifacts() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    if let Some(name) = exe.file_name().and_then(|s| s.to_str()) {
        let _ = fs::remove_file(exe.with_file_name(format!("{name}.new")));
    }
    #[cfg(windows)]
    {
        let _ = fs::remove_file(exe.with_extension("old"));
    }
}

/// Whether the daemon is running under a service manager that will relaunch it
/// automatically after a clean exit (macOS launchd `KeepAlive`, systemd
/// `Restart=always`) — so the caller can restart into the staged binary by
/// exiting. A manually-launched daemon (dev runs) returns `false`: it stays up
/// and the "restart to apply" notice tells the user to restart.
pub fn under_relaunching_service() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::env::var("XPC_SERVICE_NAME")
            .map(|v| !v.is_empty() && v != "0")
            .unwrap_or(false)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("INVOCATION_ID").is_some()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

/// Apply the hub's OWN update: download the newest release package for this OS,
/// verify the binary inside it, and stage it over the running executable (see
/// `stage_binary_swap`). Returns the release tag that was staged on success. The
/// staged binary takes effect on the next restart — the caller decides whether to
/// restart now (via a relaunching service manager) or leave the "restart to
/// apply" notice. `prerelease` widens to the beta channel.
pub fn apply_hub_update(prerelease: bool) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("locate running binary: {e}"))?;
    let release = latest_hub_release(prerelease)?;
    let tag = release_tag(&release).ok_or_else(|| "release has no usable tag".to_string())?;

    let url = find_asset_url_by_names(&release, hub_package_candidates()).ok_or_else(|| {
        format!(
            "release {tag} has no package for this platform ({})",
            hub_package_candidates().first().copied().unwrap_or("?")
        )
    })?;

    // Work in a unique temp dir so a partial download/extract never touches the
    // install directory until the verified swap.
    let work = std::env::temp_dir().join(format!("shelveshub-update-{}", std::process::id()));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| format!("create work dir: {e}"))?;

    let cleanup = |r: Result<String, String>| {
        let _ = fs::remove_dir_all(&work);
        r
    };

    let archive = work.join(url.rsplit('/').next().unwrap_or("package"));
    if let Err(e) = curl_download(&url, &archive) {
        return cleanup(Err(e));
    }
    if let Err(e) = extract_archive(&archive, &work) {
        return cleanup(Err(e));
    }

    let new_bin = work.join(hub_binary_name());
    let head = match fs::read(&new_bin) {
        Ok(bytes) => bytes,
        Err(e) => return cleanup(Err(format!("extracted binary missing: {e}"))),
    };
    if head.len() < REAL_BUNDLE_MIN_BYTES as usize || !looks_like_executable(&head) {
        return cleanup(Err(
            "downloaded binary failed verification (truncated or not an executable)".to_string(),
        ));
    }

    if let Err(e) = stage_binary_swap(&new_bin, &exe) {
        return cleanup(Err(e));
    }
    log_info(
        "populate",
        &format!(
            "Hub update {tag} staged over {} (restart to apply).",
            exe.display()
        ),
    );
    cleanup(Ok(tag))
}

/// Given a GitHub release-download URL (`.../<owner>/<repo>/releases/download/<tag>/<file>`),
/// resolve that SAME release's `*.iife.js` asset via the tags API. `None` if the URL
/// isn't a release-download URL, or that release has no IIFE asset. Lets a caller that
/// was handed the release `.zip` recover the bundle artifact from the same release.
fn resolve_iife_for_asset_url(asset_url: &str) -> Option<String> {
    let api = release_tags_api_url(asset_url)?;
    let json = curl_text(&api).ok()?;
    find_iife_asset_url(&json)
}

/// Map a GitHub release-download URL to its `releases/tags/<tag>` API URL (pure).
/// `.../<owner>/<repo>/releases/download/<tag>/<file>` →
/// `https://api.github.com/repos/<owner>/<repo>/releases/tags/<tag>`.
fn release_tags_api_url(asset_url: &str) -> Option<String> {
    let rest = asset_url.strip_prefix("https://github.com/")?;
    let idx = rest.find("/releases/download/")?;
    let repo_path = &rest[..idx]; // "<owner>/<repo>"
    let after = &rest[idx + "/releases/download/".len()..]; // "<tag>/<file>"
    let tag = after.split('/').next()?;
    if repo_path.is_empty() || tag.is_empty() {
        return None;
    }
    Some(format!(
        "https://api.github.com/repos/{repo_path}/releases/tags/{tag}"
    ))
}

/// The `*.iife.js` asset URL of the newest non-draft release in a `releases`
/// array (the API returns them newest first), so pre-releases are considered.
fn find_newest_iife_in_releases(releases_json: &str) -> Option<String> {
    let releases: serde_json::Value = serde_json::from_str(releases_json).ok()?;
    for release in releases.as_array()? {
        if release.get("draft").and_then(serde_json::Value::as_bool) == Some(true) {
            continue; // never publish from a draft
        }
        if let Some(url) = iife_asset_url(release) {
            return Some(url);
        }
    }
    None
}

/// `curl -sL <url>` → stdout as text. Used for the GitHub API call.
fn curl_text(url: &str) -> Result<String, String> {
    let out = Command::new("curl")
        .args(["-sL", "-H", "Accept: application/vnd.github+json", url])
        .output()
        .map_err(|e| format!("curl (is it installed?): {e}"))?;
    if !out.status.success() {
        return Err(format!("curl exit {:?} for {url}", out.status.code()));
    }
    String::from_utf8(out.stdout).map_err(|e| format!("curl output not UTF-8: {e}"))
}

/// `curl -sL <url> -o <dest>` — download a file.
fn curl_download(url: &str, dest: &Path) -> Result<(), String> {
    let status = Command::new("curl")
        .args(["-fsSL", url, "-o"])
        .arg(dest)
        .status()
        .map_err(|e| format!("curl (is it installed?): {e}"))?;
    if !status.success() {
        let _ = fs::remove_file(dest);
        return Err(format!("curl exit {:?} downloading {url}", status.code()));
    }
    Ok(())
}

/// Force-obtain the newest release IIFE into `dest`, ignoring any local copy.
/// Used by the host "apply update" path — always fetches the published release
/// (`prerelease` widens it to the beta channel).
pub fn update_from_release(dest: &Path, prerelease: bool) -> Result<String, String> {
    match download_latest_iife(dest, prerelease) {
        Ok(url) => Ok(url),
        Err(e) => {
            log_error("populate", &format!("update download failed: {e}"));
            Err(e)
        }
    }
}

/// Apply a plugin update from a specific release asset (the host `updates.applyUpdate`
/// path). Downloads `asset_url` into `dest` after verifying it is a GitHub-hosted JS
/// bundle (the daemon must never be steered into fetching an arbitrary URL) and a real
/// bundle (not truncated). When `asset_url` is absent, falls back to the newest release.
pub fn apply_update(
    dest: &Path,
    asset_url: Option<&str>,
    prerelease: bool,
) -> Result<String, String> {
    let resolved;
    let url = match asset_url {
        None => return update_from_release(dest, prerelease),
        Some(u) if !u.starts_with("https://github.com/") => {
            return Err(format!("refused update asset (not a GitHub url): {u}"));
        }
        Some(u) if u.ends_with(".iife.js") || u.ends_with(".js") => u,
        // The plugin hands us the release `.zip` (right for a manual download, wrong
        // for self-install). Don't refuse: resolve the SAME release's `*.iife.js`
        // asset (the release publishes both), falling back to the newest release's
        // IIFE. This is why self-install opened GitHub instead of updating in place.
        // Only `.zip` triggers this recovery — any other non-JS GitHub asset (an
        // `.exe`, etc.) is still refused outright.
        Some(u) if u.ends_with(".zip") => {
            resolved = resolve_iife_for_asset_url(u)
                .or_else(|| {
                    if prerelease {
                        curl_text(RELEASES_ALL_URL).ok().and_then(|j| find_newest_iife_in_releases(&j))
                    } else {
                        curl_text(RELEASES_LATEST_URL).ok().and_then(|j| find_iife_asset_url(&j))
                    }
                })
                .ok_or_else(|| {
                    format!("no `*.iife.js` asset resolvable for release asset {u} (publish it in the release)")
                })?;
            &resolved
        }
        Some(u) => {
            return Err(format!("refused update asset (not a GitHub .js url): {u}"));
        }
    };
    let tmp = dest.with_file_name(".bundle.update.tmp");
    curl_download(url, &tmp)?;
    if !is_real_bundle(&tmp) {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "downloaded update looks truncated/placeholder: {url}"
        ));
    }
    fs::rename(&tmp, dest).map_err(|e| format!("swap update into place: {e}"))?;
    log_info("populate", &format!("Applied plugin update from {url}"));
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_iife_asset_url() {
        let json = r#"{"assets":[
            {"name":"deck-shelves-v1.zip","browser_download_url":"https://x/zip"},
            {"name":"index.iife.js","browser_download_url":"https://x/index.iife.js"}
        ]}"#;
        assert_eq!(
            find_iife_asset_url(json).as_deref(),
            Some("https://x/index.iife.js")
        );
    }

    #[test]
    fn hub_update_finds_platform_package_in_priority_order() {
        let release: serde_json::Value = serde_json::from_str(
            r#"{"assets":[
                {"name":"shelveshub-linux.tar.gz","browser_download_url":"https://x/linux"},
                {"name":"shelveshub-steamos.tar.gz","browser_download_url":"https://x/steamos"},
                {"name":"shelveshub-macos.tar.gz","browser_download_url":"https://x/mac"}
            ]}"#,
        )
        .unwrap();
        // First name in the list wins; a missing preferred name falls back.
        assert_eq!(
            find_asset_url_by_names(
                &release,
                &["shelveshub-steamos.tar.gz", "shelveshub-linux.tar.gz"]
            )
            .as_deref(),
            Some("https://x/steamos")
        );
        assert_eq!(
            find_asset_url_by_names(
                &release,
                &["shelveshub-windows.zip", "shelveshub-macos.tar.gz"]
            )
            .as_deref(),
            Some("https://x/mac")
        );
        assert!(find_asset_url_by_names(&release, &["shelveshub-windows.zip"]).is_none());
        // The running OS always has at least one candidate name.
        assert!(!hub_package_candidates().is_empty());
    }

    #[test]
    fn stage_binary_swap_replaces_the_target_in_place() {
        let dir = std::env::temp_dir().join(format!("shelveshub-swaptest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let exe = dir.join(if cfg!(windows) {
            "shelveshub.exe"
        } else {
            "shelveshub"
        });
        let new_bin = dir.join("downloaded");
        fs::write(&exe, b"OLD-BINARY-CONTENTS").unwrap();
        fs::write(&new_bin, b"NEW-BINARY-CONTENTS-1234567890").unwrap();

        stage_binary_swap(&new_bin, &exe).unwrap();

        // The target path now carries the new contents.
        assert_eq!(fs::read(&exe).unwrap(), b"NEW-BINARY-CONTENTS-1234567890");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&exe).unwrap().permissions().mode() & 0o111,
                0o111
            );
        }
        #[cfg(windows)]
        {
            // The running binary was moved aside for cleanup on next start.
            assert!(exe.with_extension("old").exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn executable_magic_recognized_for_this_os() {
        // The right magic for the compile target passes; obvious non-executables fail.
        #[cfg(target_os = "windows")]
        assert!(looks_like_executable(b"MZ\x90\x00"));
        #[cfg(target_os = "macos")]
        assert!(looks_like_executable(&[0xCF, 0xFA, 0xED, 0xFE, 0, 0]));
        #[cfg(all(unix, not(target_os = "macos")))]
        assert!(looks_like_executable(&[0x7F, b'E', b'L', b'F', 0, 0]));
        assert!(!looks_like_executable(b"<!DOCTYPE html>"));
        assert!(!looks_like_executable(b""));
    }

    #[test]
    fn finds_backend_archive_asset() {
        let json = r#"{"assets":[
            {"name":"index.iife.js","browser_download_url":"https://x/index.iife.js"},
            {"name":"deck-shelves-backend.tar.gz","browser_download_url":"https://x/backend.tgz"}
        ]}"#;
        assert_eq!(
            find_backend_asset_url(json).as_deref(),
            Some("https://x/backend.tgz")
        );
        // No backend archive → None (data RPC stays disabled, core still works).
        let none = r#"{"assets":[{"name":"index.iife.js","browser_download_url":"https://x/i"}]}"#;
        assert!(find_backend_asset_url(none).is_none());
    }

    #[test]
    fn finds_newest_backend_archive_across_releases() {
        let json = r#"[
            {"assets":[{"name":"index.iife.js","browser_download_url":"https://x/i"}]},
            {"assets":[{"name":"deck-shelves-backend.tgz","browser_download_url":"https://x/b.tgz"}]}
        ]"#;
        assert_eq!(
            find_newest_backend_in_releases(json).as_deref(),
            Some("https://x/b.tgz")
        );
    }

    #[test]
    fn maps_release_download_url_to_tags_api() {
        assert_eq!(
            release_tags_api_url(
                "https://github.com/santojon/Deck-Shelves/releases/download/v3.2.2-beta.1/deck-shelves-v3.2.2-beta.1.zip"
            )
            .as_deref(),
            Some("https://api.github.com/repos/santojon/Deck-Shelves/releases/tags/v3.2.2-beta.1")
        );
        // Not a release-download URL → None (no recovery attempted).
        assert!(release_tags_api_url("https://github.com/santojon/Deck-Shelves").is_none());
        assert!(release_tags_api_url("https://example.com/x.zip").is_none());
    }

    #[test]
    fn no_iife_asset_returns_none() {
        let json =
            r#"{"assets":[{"name":"deck-shelves.zip","browser_download_url":"https://x/zip"}]}"#;
        assert!(find_iife_asset_url(json).is_none());
    }

    #[test]
    fn apply_update_refuses_untrusted_or_nonjs_urls() {
        let dest = std::env::temp_dir().join("shelveshub-apply-update-test.js");
        // Not GitHub-hosted.
        let e = apply_update(&dest, Some("https://evil.example.com/x.iife.js"), false).unwrap_err();
        assert!(e.contains("refused"), "{e}");
        // GitHub but not a JS bundle.
        let e2 = apply_update(
            &dest,
            Some("https://github.com/santojon/Deck-Shelves/releases/download/v1/mal.exe"),
            false,
        )
        .unwrap_err();
        assert!(e2.contains("refused"), "{e2}");
    }

    #[test]
    fn newest_non_draft_iife_wins_including_prerelease() {
        // Releases newest-first: the draft is skipped, then the newest non-draft
        // with an iife asset wins — a pre-release counts under the beta channel.
        let json = r#"[
            {"draft":true,"prerelease":false,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/draft.iife.js"}]},
            {"draft":false,"prerelease":true,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/beta.iife.js"}]},
            {"draft":false,"prerelease":false,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/stable.iife.js"}]}
        ]"#;
        assert_eq!(
            find_newest_iife_in_releases(json).as_deref(),
            Some("https://x/beta.iife.js")
        );
    }

    #[test]
    fn newest_release_tag_matches_the_newest_iife_release() {
        // The tag used by the auto-update check must come from the SAME release
        // download would pick: the draft is skipped, then the newest non-draft
        // with an iife asset. Its tag is what gets recorded/compared.
        let json = r#"[
            {"draft":true,"tag_name":"v9.9.9","assets":[{"name":"index.iife.js","browser_download_url":"https://x/draft.iife.js"}]},
            {"draft":false,"tag_name":"v3.3.0-beta.1","assets":[{"name":"index.iife.js","browser_download_url":"https://x/beta.iife.js"}]},
            {"draft":false,"tag_name":"v3.2.1","assets":[{"name":"index.iife.js","browser_download_url":"https://x/stable.iife.js"}]}
        ]"#;
        assert_eq!(
            newest_release_tag_in_releases(json).as_deref(),
            Some("v3.3.0-beta.1")
        );
    }

    #[test]
    fn release_tag_reads_tag_name_and_rejects_empty() {
        let with_tag: serde_json::Value = serde_json::from_str(r#"{"tag_name":"v3.2.1"}"#).unwrap();
        assert_eq!(release_tag(&with_tag).as_deref(), Some("v3.2.1"));
        let empty: serde_json::Value = serde_json::from_str(r#"{"tag_name":""}"#).unwrap();
        assert!(release_tag(&empty).is_none());
        let missing: serde_json::Value = serde_json::from_str(r#"{}"#).unwrap();
        assert!(release_tag(&missing).is_none());
    }

    #[test]
    fn placeholder_is_not_a_real_bundle() {
        let dir = std::env::temp_dir().join("shelveshub-populate-test");
        let _ = fs::create_dir_all(&dir);
        let p = dir.join("placeholder.js");
        fs::write(&p, b"// placeholder\n").unwrap();
        assert!(!is_real_bundle(&p));
        fs::write(&p, vec![b'x'; 8192]).unwrap();
        assert!(is_real_bundle(&p));
        let _ = fs::remove_file(&p);
    }
}
