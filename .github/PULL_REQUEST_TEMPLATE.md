<!--
  PR title MUST start with one of these tags:
    [FIX]         — Bug fix
    [ENHANCEMENT] — Small improvement
    [PERF]        — Performance improvement
    [QA]          — Test harness / instrumentation
    [REFACTOR]    — Refactor/restructure
    [CLEANUP]     — Code cleanup
    [FEATURE]     — New feature

  Example: [FIX] Keep the service running after a Steam restart
-->

## Description

<!-- AUTOFILL:DESCRIPTION:START -->
<!-- Describe what this PR does and why. -->
<!-- AUTOFILL:DESCRIPTION:END -->

## Related Issues

<!-- Link issues closed or addressed by this PR (one per line, 0 or more). -->
<!-- Example: Closes #42 -->

## Changelog

<!-- AUTOFILL:CHANGELOG:START -->
<!-- Required. Add entries under ## [Unreleased] in CHANGELOG.md (technical detail). -->
<!-- Example: "- Reconnect to the debug endpoint after a Steam restart." -->
<!-- AUTOFILL:CHANGELOG:END -->

## Release Notes

<!-- AUTOFILL:RELEASE_NOTES:START -->
<!-- Required. Add entries under ## [Unreleased] in RELEASE_NOTES.md (user-facing, less jargon). -->
<!-- Release bodies are extracted from this file at tag time. -->
<!-- Example: "- The service now recovers on its own after Steam restarts." -->
<!-- AUTOFILL:RELEASE_NOTES:END -->

## Type of Change

<!-- At least ONE of the first three rows MUST be checked. The CI validator
     enforces this — a PR with none of the main categories selected fails the
     `pr-checklist` check. -->

- [ ] Refactor / restructure (`[REFACTOR]`)
- [ ] New feature / Code cleanup (`[FEATURE]`, `[CLEANUP]`)
- [ ] Bug fix / Enhancement / QA / Performance update (`[FIX]`, `[ENHANCEMENT]`, `[QA]`, `[PERF]`)
- [ ] Documentation update
- [ ] i18n / localization
- [ ] Build / CI change

## Checklist

<!-- ALL items must be checked. The "i18n keys" line is required only when the
     "i18n / localization" Type of Change is checked above; otherwise it can be
     left unchecked and the validator will skip it. -->

- [ ] My PR title starts with `[FIX]`, `[ENHANCEMENT]`, `[PERF]`, `[QA]`, `[REFACTOR]`, `[CLEANUP]`, or `[FEATURE]`.
- [ ] I added my changes to `CHANGELOG.md` and `RELEASE_NOTES.md` under `## [Unreleased]`.
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass locally.
- [ ] If I changed the injected runtime, `node --check runtime/shelves-host.js` passes.
- [ ] If I added i18n keys, I added them to **all** locale files.

## Screenshots / Videos

<!-- If applicable, add screenshots or a short capture of the change on a device. -->

## Additional Notes

<!-- Anything else reviewers should know. -->
