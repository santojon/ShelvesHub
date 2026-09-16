# Contributing

Thanks for your interest in contributing to ShelvesHub. Below are recommended steps and conventions used by this project.

## Getting started

`pnpm` is the single entry point. One-time setup is cross-platform — `pnpm setup`
auto-dispatches to the right per-OS installer:

```bash
pnpm setup     # macOS → Homebrew · Linux/SteamOS → rustup.rs · Windows → winget/rustup
pnpm build     # cargo build (loader + shelves-devtools)
pnpm test      # cargo test
pnpm lint      # cargo clippy -- -D warnings  (same as CI)
pnpm run       # run the loader locally
```

See [docs/development.md](docs/development.md) for the full task list.

## Supported platforms

The core dev loop (`setup` / `build` / `test` / `lint` / `run` / `devtools` /
`debug:local` / `deck:*` CDP tasks) runs natively on **Windows, macOS, SteamOS,
and other Linux**. The SSH-deploy / cross-compile tasks (`build:deck`,
`deck:deploy`, `deck:tunnel`, `deck:logs`) are bash and target a Linux Deck —
on Windows run them under WSL / Git Bash.

## Development workflow
- Fork the repository and open pull requests against `main`.
- Keep changes small and focused. Each PR should address a single issue or enhancement.

## Branching, releases and tags
- Releases are produced from semantic version tags matching `vMAJOR.MINOR.PATCH` (for example `v0.1.0`).
- The project uses a release workflow that triggers on pushed tags — see `.github/workflows/release.yml`.

## Tests and checks
- Add unit tests where appropriate. CI currently runs builds for Linux, macOS, and Windows.

## Commits and PRs
- Use clear commit messages.
- **PR titles must start with a tag** — the automated version bump and the
  `PR · Checklist` gate both depend on it:
  - `[FIX]` — bug fix
  - `[ENHANCEMENT]` — small improvement
  - `[PERF]` — performance improvement
  - `[QA]` — test harness / instrumentation
  - `[REFACTOR]` — refactor/restructure
  - `[CLEANUP]` — code cleanup
  - `[FEATURE]` — new feature

  Example: `[FIX] Keep the service running after a Steam restart`.
- Merged PRs bump the version automatically: `[REFACTOR]` → major, `[FEATURE]`/`[CLEANUP]` → minor, the rest → patch. See `.github/workflows/bump.yml`.
- Add your change under `## [Unreleased]` in both `CHANGELOG.md` (technical) and `RELEASE_NOTES.md` (user-facing). The version bump promotes these to a dated entry, and the release body is extracted from them.
- Fill in the PR template checklist — the `PR · Checklist` check enforces it.
- Issue and PR triage labels are applied automatically; see [.github/TRIAGE.md](.github/TRIAGE.md).
