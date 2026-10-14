// Unit tests for the `logger` module, attached via
// `#[cfg(test)] #[path = "tests/logger_tests.rs"] mod tests;` — `super::*`
// reaches the module's private items.

use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("shelveshub-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn log_file_sits_in_logs_beside_the_token() {
    let token = Path::new("/data/shelveshub/.rpc-token");
    assert_eq!(
        log_file_beside(token),
        Path::new("/data/shelveshub/logs/out.log")
    );
    assert_eq!(
        rotated_path(Path::new("/data/shelveshub/logs/out.log")),
        Path::new("/data/shelveshub/logs/out.log.1")
    );
}

#[test]
fn append_line_creates_the_directory_and_rotates_past_the_cap() {
    let dir = scratch("logtest");
    let path = dir.join("logs").join("out.log");

    append_line(&path, "first", 10).unwrap();
    append_line(&path, "second", 10).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "first\nsecond\n");

    // Past the cap: the next line opens a fresh file, the full one is kept as `.1`.
    append_line(&path, "third", 10).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "third\n");
    assert_eq!(
        fs::read_to_string(rotated_path(&path)).unwrap(),
        "first\nsecond\n"
    );

    // A second rotation replaces the kept file instead of failing on it.
    append_line(&path, "fourth-is-long-enough", 10).unwrap();
    append_line(&path, "fifth", 10).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "fifth\n");
    assert_eq!(
        fs::read_to_string(rotated_path(&path)).unwrap(),
        "third\nfourth-is-long-enough\n"
    );
    let _ = fs::remove_dir_all(&dir);
}
