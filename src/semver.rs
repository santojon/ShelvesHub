//! Release-version ordering shared by the automatic update check and the
//! manual `selfUpdate` RPC, so both decide "newer" the same way.

use std::cmp::Ordering;

/// True when tag `latest` is strictly newer than the running `current` by
/// semver precedence (a stable outranks its pre-release; identifiers compare
/// numerically, then lexically). Unparseable input never counts as newer.
pub fn version_is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => semver_precedence(&l, &c) == Ordering::Greater,
        _ => false,
    }
}

/// (major, minor, patch) + the dot-separated pre-release identifiers (empty = a
/// stable release). Build metadata (`+…`) is ignored, per semver.
type Semver = ((u64, u64, u64), Vec<String>);

fn parse_semver(s: &str) -> Option<Semver> {
    let s = s.trim().trim_start_matches('v');
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, p.split('+').next().unwrap_or("")),
        None => (s.split('+').next().unwrap_or(s), ""),
    };
    let mut it = core.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next()?.parse().ok()?;
    let pre_ids = if pre.is_empty() {
        Vec::new()
    } else {
        pre.split('.').map(str::to_string).collect()
    };
    Some(((major, minor, patch), pre_ids))
}

fn semver_precedence(a: &Semver, b: &Semver) -> Ordering {
    match a.0.cmp(&b.0) {
        Ordering::Equal => {}
        core => return core,
    }
    // Equal core: a stable (no pre-release) outranks a pre-release of that core.
    match (a.1.is_empty(), b.1.is_empty()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => cmp_prerelease(&a.1, &b.1),
    }
}

/// Compare pre-release identifier lists (semver §11): numeric identifiers compare
/// numerically and rank below alphanumeric ones; a longer list outranks a prefix.
fn cmp_prerelease(a: &[String], b: &[String]) -> Ordering {
    for (x, y) in a.iter().zip(b.iter()) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(nx), Ok(ny)) => nx.cmp(&ny),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            (Err(_), Err(_)) => x.as_str().cmp(y.as_str()),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    a.len().cmp(&b.len())
}

#[cfg(test)]
#[path = "tests/semver_tests.rs"]
mod tests;
