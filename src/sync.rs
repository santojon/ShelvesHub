//! Settings sync across devices through Steam's roaming storage.
//!
//! The hub keeps one document of its own, under its own key, in
//! `SteamClient.RoamingStorage`; Steam carries it between the devices the user
//! signs in on. Only this daemon writes the document, so nothing else has to
//! know about it. Each synced setting travels with the time it last changed,
//! and a round keeps, per setting, the most recent change from any device —
//! two devices edited independently converge instead of overwriting each other.
//!
//! Only user intent syncs: the update switches and the toggles in the tab's
//! Configuration section. Device-local operation (endpoints, paths, ownership,
//! intervals, the recovery command) never leaves the device, and a value is
//! applied only when it is the boolean its key expects.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::cdp::CdpClient;
use crate::config::Config;
use crate::logger::{log_info, log_warning};
use crate::state;
use crate::store::HubSettings;

/// The hub's own key in Steam's roaming storage.
pub const CLOUD_KEY: &str = "shelveshub-settings-sync-v1";
const DOC_VERSION: u64 = 1;

/// Store-held settings that sync: the update hierarchy and quiet updates.
const STORE_KEYS: [&str; 6] = [
    "auto_update",
    "auto_update_hub",
    "hub_prerelease",
    "auto_update_plugin",
    "plugin_prerelease",
    "quiet_updates",
];
/// Config-file toggles that sync (the tab's Configuration section).
pub const CONFIG_KEYS: [&str; 3] = ["desktop_ui", "native_notifications", "boot_movie"];
/// Config keys the daemon reads only at start-up — a synced change needs a restart.
const RESTART_KEYS: [&str; 2] = ["desktop_ui", "native_notifications"];

/// One synced setting: its value and when it last changed (ms since the epoch).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Entry {
    pub value: Value,
    pub at: u64,
}

/// The roaming document. Fields and entries this build doesn't know are carried
/// through untouched, so an older daemon never drops what a newer one wrote.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Doc {
    pub v: u64,
    pub updated_at: u64,
    pub from: String,
    pub entries: BTreeMap<String, Entry>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Doc {
    /// Parse the stored text; `None` for an empty, invalid or unversioned value.
    pub fn parse(raw: &str) -> Option<Doc> {
        let doc: Doc = serde_json::from_str(raw.trim()).ok()?;
        (doc.v >= 1).then_some(doc)
    }
}

/// What one round decided: the document to keep, the values to take over from
/// the other devices, and whether the document changed and must be written.
#[derive(Debug, Default, PartialEq)]
pub struct Merge {
    pub entries: BTreeMap<String, Entry>,
    pub adopt: Vec<(String, Value)>,
    pub push: bool,
}

/// Per key, the most recent change wins. On an equal stamp with different
/// values the shared copy wins, so a device syncing for the first time takes
/// over what is already there. Entries for keys unknown here are kept as is.
pub fn merge(local: &BTreeMap<String, Entry>, cloud: &BTreeMap<String, Entry>) -> Merge {
    let mut out = Merge {
        entries: cloud.clone(),
        ..Default::default()
    };
    for (key, mine) in local {
        match cloud.get(key) {
            Some(theirs)
                if theirs.at > mine.at || (theirs.at == mine.at && theirs.value != mine.value) =>
            {
                out.adopt.push((key.clone(), theirs.value.clone()));
            }
            Some(theirs) if theirs.at == mine.at => {}
            _ => {
                out.entries.insert(key.clone(), mine.clone());
                out.push = true;
            }
        }
    }
    out
}

/// Stamp the local values: one that changed since the last round carries the
/// current time, as does, for a key never synced from here, one that is not the
/// default; an unchanged value keeps the stamp it had (0 = never changed).
pub fn stamp(
    local: &BTreeMap<String, Value>,
    base: &Map<String, Value>,
    stamps: &BTreeMap<String, u64>,
    defaults: &BTreeMap<String, Value>,
    now: u64,
) -> BTreeMap<String, Entry> {
    local
        .iter()
        .map(|(key, value)| {
            let changed = match base.get(key) {
                Some(seen) => seen != value,
                None => defaults.get(key) != Some(value),
            };
            let at = if changed {
                now
            } else {
                stamps.get(key).copied().unwrap_or(0)
            };
            (
                key.clone(),
                Entry {
                    value: value.clone(),
                    at,
                },
            )
        })
        .collect()
}

/// Whether a synced config key means anything on this platform: the desktop-
/// client toggle only exists where there is a desktop client to inject into.
fn applies_here(key: &str) -> bool {
    key != "desktop_ui" || !cfg!(target_os = "linux")
}

fn store_values(settings: &HubSettings) -> BTreeMap<String, Value> {
    let all = serde_json::to_value(settings).unwrap_or(Value::Null);
    STORE_KEYS
        .iter()
        .filter_map(|k| all.get(*k).map(|v| (k.to_string(), v.clone())))
        .collect()
}

/// The config file's value for a synced key, else the value in effect at boot.
fn config_value(file: &Map<String, Value>, key: &str) -> Option<Value> {
    file.get(key)
        .cloned()
        .or_else(|| state::runtime_config().and_then(|rc| rc.get(key).cloned()))
}

fn local_values(settings: &HubSettings, file: &Map<String, Value>) -> BTreeMap<String, Value> {
    let mut values = store_values(settings);
    for key in CONFIG_KEYS.iter().filter(|k| applies_here(k)) {
        if let Some(v) = config_value(file, key) {
            values.insert(key.to_string(), v);
        }
    }
    values
}

fn defaults() -> BTreeMap<String, Value> {
    let mut values = store_values(&HubSettings::default());
    values.insert("desktop_ui".to_string(), Value::Bool(false));
    values.insert("native_notifications".to_string(), Value::Bool(true));
    values.insert("boot_movie".to_string(), Value::Bool(false));
    values
}

fn set_store_value(settings: &mut HubSettings, key: &str, value: bool) -> bool {
    let slot = match key {
        "auto_update" => &mut settings.auto_update,
        "auto_update_hub" => &mut settings.auto_update_hub,
        "hub_prerelease" => &mut settings.hub_prerelease,
        "auto_update_plugin" => &mut settings.auto_update_plugin,
        "plugin_prerelease" => &mut settings.plugin_prerelease,
        "quiet_updates" => &mut settings.quiet_updates,
        _ => return false,
    };
    *slot = value;
    true
}

/// Whether a config value differs from the one the running daemon started with
/// for a key it only reads at start-up.
pub fn needs_restart(key: &str, value: &Value) -> bool {
    RESTART_KEYS.contains(&key) && state::runtime_config().and_then(|rc| rc.get(key)) != Some(value)
}

fn apply_boot_movie(enabled: bool) {
    let Some(source) = state::boot_movie_source() else {
        return;
    };
    match crate::bootmovie::apply(enabled, source) {
        Ok(_) => state::set_boot_movie_enabled(enabled),
        Err(e) => log_warning("sync", &format!("boot movie not applied: {e}")),
    }
}

/// Take over the values decided for this device: store fields in place, config
/// keys into the config file object (the boot animation also installs/removes on
/// the spot). Only booleans for known keys are ever written. Returns the keys
/// applied and whether one of them takes effect on the next restart.
pub fn apply(
    adopt: &[(String, Value)],
    settings: &mut HubSettings,
    file: &mut Map<String, Value>,
) -> (Vec<String>, bool) {
    let mut applied = Vec::new();
    let mut restart = false;
    for (key, value) in adopt {
        let Some(b) = value.as_bool() else {
            continue;
        };
        if set_store_value(settings, key, b) {
            applied.push(key.clone());
        } else if CONFIG_KEYS.contains(&key.as_str()) && applies_here(key) {
            restart |= needs_restart(key, value);
            file.insert(key.clone(), Value::Bool(b));
            if key == "boot_movie" {
                apply_boot_movie(b);
            }
            applied.push(key.clone());
        }
    }
    (applied, restart)
}

use crate::config::{read_config_object, write_config_object};
use crate::state::now_ms;

fn device_label() -> String {
    let d = crate::config::detected_device();
    let field = |k: &str| d.get(k).and_then(Value::as_str).unwrap_or("?").to_string();
    format!("{}/{}", field("kind"), field("arch"))
}

/// The roaming value for the key: `Ok(None)` when nothing is stored yet (Steam
/// rejects a read of a missing key with "Not found"), `Err` when roaming storage
/// is not reachable in this renderer or the read failed some other way.
fn read_cloud(client: &mut CdpClient) -> Result<Option<Doc>, String> {
    let expr = format!(
        "(function(k){{try{{var rs=window.SteamClient&&window.SteamClient.RoamingStorage;\
         if(!rs||typeof rs.GetString!==\"function\")return null;\
         return Promise.resolve(rs.GetString(k)).then(function(v){{return typeof v===\"string\"?v:\"\";}},\
         function(e){{return /not found/i.test(String(e&&e.message||\"\"))?\"\":null;}});}}\
         catch(e){{return null;}}}})({})",
        Value::String(CLOUD_KEY.to_string())
    );
    match client.evaluate(&expr).map_err(|e| e.to_string())? {
        Value::String(raw) => Ok(Doc::parse(&raw)),
        _ => Err(NO_ROAMING_API.to_string()),
    }
}

const NO_ROAMING_API: &str = "no RoamingStorage API";

/// Write the document and confirm it reads back unchanged.
fn write_cloud(client: &mut CdpClient, doc: &Doc) -> bool {
    let text = serde_json::to_string(doc).unwrap_or_default();
    let expr = format!(
        "(function(k,s){{try{{var rs=window.SteamClient.RoamingStorage;\
         return Promise.resolve(rs.SetString(k,s)).then(function(){{return rs.GetString(k);}})\
         .then(function(v){{return v===s;}},function(){{return false;}});}}catch(e){{return false;}}}})({},{})",
        Value::String(CLOUD_KEY.to_string()),
        Value::String(text)
    );
    client
        .evaluate(&expr)
        .map(|v| v.as_bool() == Some(true))
        .unwrap_or(false)
}

static UNAVAILABLE_LOGGED: AtomicBool = AtomicBool::new(false);

/// One round: read the roaming document, settle each key, take over what the
/// other devices changed, write the document back when this device changed
/// something, and remember where things stand. Quiet on a miss — the next round
/// retries from the same state.
pub fn run(config: &Config) {
    let mut settings = crate::store::load(&config.hub_config_path);
    if !settings.config_sync {
        return;
    }
    let file_path = state::config_file_path();
    let mut file = file_path.map(|p| read_config_object(p)).unwrap_or_default();
    let local = local_values(&settings, &file);
    if local.is_empty() {
        return;
    }
    let now = now_ms();
    let mine = stamp(
        &local,
        &settings.sync_base,
        &settings.sync_stamps,
        &defaults(),
        now,
    );
    let Ok(mut client) = CdpClient::connect_renderer(
        &config.cef_host,
        config.cef_port,
        config.target_filter.as_deref(),
    ) else {
        return;
    };
    let cloud = match read_cloud(&mut client) {
        Ok(doc) => doc,
        Err(e) => {
            // A renderer without the API is a platform fact (said once); a read that
            // failed in transit — a round that met a Steam restart — just waits for the next.
            if e == NO_ROAMING_API {
                if !UNAVAILABLE_LOGGED.swap(true, Ordering::Relaxed) {
                    log_warning("sync", &format!("settings sync off: {e}"));
                }
            } else {
                log_warning(
                    "sync",
                    &format!("round skipped ({e}) — retrying next round."),
                );
            }
            return;
        }
    };
    let theirs = cloud
        .as_ref()
        .map(|d| d.entries.clone())
        .unwrap_or_default();
    let decided = merge(&mine, &theirs);
    let (applied, restart) = apply(&decided.adopt, &mut settings, &mut file);
    if applied.iter().any(|k| CONFIG_KEYS.contains(&k.as_str())) {
        if let Some(p) = file_path {
            if let Err(e) = write_config_object(p, &file) {
                log_warning("sync", &format!("config file not updated: {e}"));
            }
        }
    }
    let mut written = false;
    if decided.push {
        let doc = Doc {
            v: DOC_VERSION,
            updated_at: now,
            from: device_label(),
            entries: decided.entries.clone(),
            extra: cloud.map(|d| d.extra).unwrap_or_default(),
        };
        written = write_cloud(&mut client, &doc);
        if !written {
            log_warning("sync", "roaming copy not written — retrying next round.");
        }
    }
    if written || !decided.push {
        settings.sync_base = local
            .keys()
            .filter_map(|k| decided.entries.get(k).map(|e| (k.clone(), e.value.clone())))
            .collect();
        settings.sync_stamps = local
            .keys()
            .filter_map(|k| decided.entries.get(k).map(|e| (k.clone(), e.at)))
            .collect();
        settings.sync_last_at = now;
    }
    if let Err(e) = crate::store::save(&config.hub_config_path, &settings) {
        log_warning("sync", &format!("could not save the settings: {e}"));
    }
    if !applied.is_empty() {
        log_info(
            "sync",
            &format!("Took {} from another device.", applied.join(", ")),
        );
        let key = if restart {
            "notice_sync_restart"
        } else {
            "notice_sync_applied"
        };
        state::push_host_notice(key, serde_json::json!({}));
    }
    if written {
        log_info("sync", "Roaming copy updated with this device's changes.");
    }
}

#[cfg(test)]
#[path = "tests/sync_tests.rs"]
mod tests;
