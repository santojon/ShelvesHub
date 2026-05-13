# Contributing

Thanks for your interest in contributing to Shelves Loader. Below are recommended steps and conventions used by this project.

## Development workflow
- Fork the repository and open pull requests against `main`.
- Keep changes small and focused. Each PR should address a single issue or enhancement.

## Branching, releases and tags
- Releases are produced from semantic version tags matching `vMAJOR.MINOR.PATCH` (for example `v0.1.0`).
- The project uses a release workflow that triggers on pushed tags — see `.github/workflows/release.yml`.

## Tests and checks
- Add unit tests where appropriate. CI currently runs builds for Linux, macOS, and Windows.

## Commits and PRs
- Use clear commit messages. For automated releases, consider following conventional commits (feat:, fix:, chore:, docs:, etc.).
