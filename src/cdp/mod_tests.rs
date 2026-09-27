// Unit tests for the `mod` module, extracted from mod.rs and attached
// via `#[cfg(test)] #[path = "mod_tests.rs"] mod tests;` — `super::*`
// still reaches the module's private items.

use super::*;

#[test]
fn finds_renderer_by_filter() {
    let targets = vec![
        Target {
            id: "1".into(),
            kind: "page".into(),
            title: "Other".into(),
            url: "https://example.com".into(),
            ws_url: Some("ws://h:1/a".into()),
        },
        Target {
            id: "2".into(),
            kind: "page".into(),
            title: "SharedJSContext".into(),
            url: "https://steamloopback.host".into(),
            ws_url: Some("ws://h:1/b".into()),
        },
    ];
    assert_eq!(find_renderer(&targets, None).unwrap().id, "2");
    assert_eq!(find_renderer(&targets, Some("other")).unwrap().id, "1");
}

#[test]
fn gamepad_ui_active_distinguishes_desktop_from_big_picture() {
    let t = |title: &str, url: &str| Target {
        id: "x".into(),
        kind: "page".into(),
        title: title.into(),
        url: url.into(),
        ws_url: Some("ws://h:1/a".into()),
    };
    // Desktop client alone → not the gamepad UI.
    let desktop = vec![
        t("Steam", "https://steamloopback.host/"),
        t(
            "SharedJSContext",
            "https://steamloopback.host/routes/library/home",
        ),
    ];
    assert!(!gamepad_ui_active(&desktop));
    // Big Picture window (gamepad user-agent) → gamepad UI active.
    let bp = vec![
        t(
            "Steam — Big Picture Mode",
            "about:blank?browser=-1&useragent=Valve%20Steam%20Gamepad",
        ),
        t(
            "SharedJSContext",
            "https://steamloopback.host/routes/library/home",
        ),
    ];
    assert!(gamepad_ui_active(&bp));
    // QuickAccess popup also counts.
    assert!(gamepad_ui_active(&[t(
        "QuickAccess_uid7",
        "about:blank?browserviewpopup=1"
    )]));
}

#[test]
fn skips_targets_without_ws_url() {
    let targets = vec![Target {
        id: "1".into(),
        kind: "page".into(),
        title: "x".into(),
        url: "y".into(),
        ws_url: None,
    }];
    assert!(find_renderer(&targets, None).is_none());
}

#[test]
fn detects_collapsed_ui_windows() {
    let shared = Target {
        id: "1".into(),
        kind: "page".into(),
        title: "SharedJSContext".into(),
        url: "https://steamloopback.host/routes/library/home".into(),
        ws_url: Some("ws://h:1/a".into()),
    };
    // Only SharedJSContext survives → UI windows collapsed (black screen).
    assert!(!ui_windows_present(std::slice::from_ref(&shared)));

    // With the Big Picture window present → UI is healthy.
    let big_picture = Target {
        id: "2".into(),
        kind: "page".into(),
        title: "Steam — Big Picture Mode".into(),
        url: "about:blank".into(),
        ws_url: Some("ws://h:1/b".into()),
    };
    assert!(ui_windows_present(&[shared, big_picture]));
}
