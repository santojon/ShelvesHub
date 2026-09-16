use chrono::{Local, TimeZone};

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
    // Mirror into the in-memory ring the `getLogs` RPC serves (the log viewer,
    // which merges these daemon lines with runtime lines pushed over RPC).
    crate::state::push_log(line);
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
