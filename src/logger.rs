use std::fmt;
use chrono::Local;

#[derive(Debug)]
pub enum LogLevel {
    INFO,
    WARNING,
    ERROR,
    DEBUG,
}

pub fn log(level: LogLevel, subsystem: &str, message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    println!("[{:?}] [{}] [{}] {}", level, timestamp, subsystem, message);
}

pub fn log_info(subsystem: &str, message: &str) {
    log(LogLevel::INFO, subsystem, message);
}

pub fn log_warning(subsystem: &str, message: &str) {
    log(LogLevel::WARNING, subsystem, message);
}

pub fn log_error(subsystem: &str, message: &str) {
    log(LogLevel::ERROR, subsystem, message);
}