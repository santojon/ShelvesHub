# AI Usage

ShelvesHub is designed and maintained by its author. In line with the growing
community practice of being transparent about tooling, this is a statement of
**where AI assists the project — and where it does not**.

## Where AI is used

AI is used as a **supporting tool**, the same way a linter, a formatter, or a
search engine is — never as the author of the host's behaviour. It helps with:

- **Auxiliary scripts and tooling** — build, packaging, installers' scaffolding,
  CI workflows, the deploy and release helpers under `scripts/`, and the QA lab
  (the runtime harness, the daemon scenarios, the container legs, the QA matrix).
- **Internationalization** — drafting and maintaining the translations under
  `runtime/i18n/` and the Portuguese pages under `docs/pt-BR/`.
- **Debugging** — reproducing issues on the test devices, narrowing them down,
  and proposing fixes.
- **Documentation** — drafting and tidying the docs, code comments, the site's
  text, and the internal notes.

## What AI is **not** used for

- **The host's behaviour — its design *and* its implementation — is the
  maintainer's own work.** How ShelvesHub discovers Steam, when it injects and
  when it stands down, the ownership modes next to another host, the update and
  recovery policy, the host contract the plugin consumes, the security
  boundaries of the local RPC: each is conceived, decided and built by the
  maintainer; it is not idea-only direction handed to an AI to implement.
- Everything AI proposes — scripts, translations, docs, or a diagnosis — is
  **reviewed, tested, and adjusted by hand** before it ships. The maintainer is
  accountable for every line in this repository.

## Why this file exists

Transparency. If you're evaluating, contributing to, or forking ShelvesHub,
you deserve to know how it's made. Questions are welcome in the
[discussions](https://github.com/santojon/ShelvesHub/discussions).
