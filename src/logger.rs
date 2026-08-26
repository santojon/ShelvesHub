use chrono::Local;

#[derive(Debug)]
pub enum LogLevel {
    Info,
    Warning,
    Error,
}

pub fn log(level: LogLevel, subsystem: &str, message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("[{level:?}] [{timestamp}] [{subsystem}] {message}");
    println!("{line}");
    // Mirror into the in-memory ring the `getLogs` RPC serves (the fallback
    // panel's "view logs" action).
    crate::state::push_log(line);
}

pub fn log_info(subsystem: &str, message: &str) {
    log(LogLevel::Info, subsystem, message);
}

pub fn log_warning(subsystem: &str, message: &str) {
    log(LogLevel::Warning, subsystem, message);
}

pub fn log_error(subsystem: &str, message: &str) {
    log(LogLevel::Error, subsystem, message);
}
