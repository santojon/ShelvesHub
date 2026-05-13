use chrono::Local;

#[derive(Debug)]
pub enum LogLevel {
    Info,
    Warning,
    Error,
    Debug,
}

pub fn log(level: LogLevel, subsystem: &str, message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    println!("[{:?}] [{}] [{}] {}", level, timestamp, subsystem, message);
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

pub fn log_debug(subsystem: &str, message: &str) {
    log(LogLevel::Debug, subsystem, message);
}
