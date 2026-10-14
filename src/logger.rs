use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{Local, TimeZone};

use crate::constants::defaults::LOG_FILE_CAP_BYTES;

#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl LogLevel {
    /// Short, uppercase tag shared with the runtime logger so both the daemon
    /// and the host runtime render identically in the log viewer.
    pub fn tag(self) -> &'static str {
        match self {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }
}

/// One formatted log line: `[LEVEL] [timestamp] [scope] message`. The scope is
/// a free-text subsystem (daemon side: "loader"/"backend"/…; runtime side:
/// "HOST"/"UI"/… forwarded via the `pushLogs` RPC), so a single ring holds both.
pub fn format_line(level: LogLevel, timestamp: &str, subsystem: &str, message: &str) -> String {
    format!("[{}] [{timestamp}] [{subsystem}] {message}", level.tag())
}

pub fn log(level: LogLevel, subsystem: &str, message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let line = format_line(level, &timestamp, subsystem, message);
    println!("{line}");
    // The Windows logon task captures no stdout (launchd and journald do), so
    // the line also goes to a file there.
    if cfg!(windows) {
        if let Some(path) = log_file_path() {
            let _ = append_line(&path, &line, LOG_FILE_CAP_BYTES);
        }
    }
    // Mirror into the in-memory ring the `getLogs` RPC serves (the log viewer,
    // which merges these daemon lines with runtime lines pushed over RPC).
    crate::state::push_log(line);
}

static FILE_SINK: Mutex<()> = Mutex::new(());

/// The daemon's log file on Windows: `logs\out.log` beside the RPC token
/// (`%LOCALAPPDATA%\shelveshub`, which is the install directory there).
fn log_file_path() -> Option<PathBuf> {
    crate::config::rpc_token_path().map(|token| log_file_beside(&token))
}

fn log_file_beside(token: &Path) -> PathBuf {
    token.with_file_name("logs").join("out.log")
}

/// `<name>.1`: the previous log, kept when the current one passes the cap.
fn rotated_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{name}.1"))
}

/// Append one line to `path`, creating its directory; a file already past `cap`
/// bytes is moved to `rotated_path` first, so the log never grows unbounded.
/// Serialised across threads so a rotation never splits a line.
fn append_line(path: &Path, line: &str, cap: u64) -> std::io::Result<()> {
    let _guard = FILE_SINK.lock().unwrap_or_else(|e| e.into_inner());
    if fs::metadata(path).map(|m| m.len() > cap).unwrap_or(false) {
        fs::rename(path, rotated_path(path))?;
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

pub fn log_info(subsystem: &str, message: &str) {
    log(LogLevel::Info, subsystem, message);
}

pub fn log_warning(subsystem: &str, message: &str) {
    log(LogLevel::Warn, subsystem, message);
}

pub fn log_error(subsystem: &str, message: &str) {
    log(LogLevel::Error, subsystem, message);
}

/// Push a log line originating in the host RUNTIME (renderer side), forwarded
/// over the `pushLogs` RPC. It goes into the same ring the daemon logs use so
/// the log viewer shows one merged, consistently-formatted stream. `t_ms` is the
/// runtime's own timestamp (epoch millis); we fall back to now when absent. These
/// lines are NOT echoed to daemon stdout — they already appeared in the renderer
/// console; the ring is what the viewer reads.
pub fn log_runtime(level: LogLevel, scope: &str, message: &str, t_ms: Option<i64>) {
    let ts = t_ms
        .and_then(|ms| Local.timestamp_millis_opt(ms).single())
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    crate::state::push_log(format_line(level, &ts, scope, message));
}

#[cfg(test)]
#[path = "tests/logger_tests.rs"]
mod tests;
