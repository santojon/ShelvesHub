# Issue Triage

Triage is automated by GitHub Actions workflows. This document is the source of
truth for the labels and the rules that apply them — keep it in sync with the
workflows under `.github/workflows/`. Labels themselves are created and kept
consistent by `Ops · Enforce repo settings` (`enforce-repo-settings.yml`).

## Label families

| Family | Labels |
|---|---|
| `type::` | `bug`, `feature`, `enhancement`, `duplicated`, `invalid`, `wontfix` |
| `priority::` | `critical`, `high`, `medium`, `low` |
| `OS::` | `SteamOS`, `Bazzite`, `Chimera`, `MacOS`, `Windows`, `OtherHoloISO` |
| `host::` | `sole`, `coexist`, `cooperative` |
| `steam::` | `stable`, `beta` |
| `area::` | `loader`, `cdp`, `populate`, `rpc`, `backend`, `runtime`, `contract`, `installer`, `i18n`, `docs`, `ci`, `daemon` |
| control | `keep-open`, `needs-info`, `needs-decision`, `stale` |

## 1. Type — from the issue title

Workflow: `Triage · Label type (title)` (`issue-auto-labeler.yml`). Runs on
`issues`. The **title prefix** decides the type (case-insensitive, optional
`[ ]`):

- `fix` / `bug` / `hotfix` → **`type::bug`**
- `feat` / `feature` → **`type::feature`**
- `enh` / `enhance` / `enhancement` / `improve` → **`type::enhancement`**

No match → no type label (left for a maintainer). Existing type labels are never
overwritten. The issue forms also apply the type label directly on open.

## 2. OS / host mode / Steam channel — from title + body

Workflow: `Triage · Label OS / host mode` (`issue-os-labeler.yml`). Runs on
`issues`. Case-insensitive regex over `title\nbody`:

- **OS:** `bazzite` → `OS::Bazzite`; `chimera(os)` → `OS::Chimera`;
  `mac os` / `macos` / `darwin` / `osx` → `OS::MacOS`;
  `windows` / `win10|11|7|8` → `OS::Windows`; `steamos` (+ variants) → `OS::SteamOS`;
  `holoiso` → `OS::OtherHoloISO`.
- **Host mode:** `sole` → `host::sole`; `coexist` → `host::coexist`;
  `cooperative` → `host::cooperative`.
- **Steam client channel** (applied when unambiguous, from the bug-report form
  dropdown): `beta` / `pre-release` → `steam::beta`; `stable` → `steam::stable`.
- **Fallback:** if no OS matched but the text mentions `steam deck` (and not
  Windows/Mac) → `OS::SteamOS`, so the issue is never left unrouted.

## 3. Priority — derived

Workflow: `Triage · Label priority` (`issue-priority-labeler.yml`). Runs on
`issues` (`opened`, `edited`, `reopened`, `labeled`, `unlabeled`). Uses the
`type::` / `OS::` labels (with a title/body fallback, since the OS labeler runs
in parallel):

| Condition | Priority |
|---|---|
| **bug** on a supported OS (SteamOS / macOS / Windows / Bazzite / Chimera) | **`priority::high`** |
| **bug** elsewhere | **`priority::medium`** |
| everything else | **`priority::low`** |

`priority::critical` is manual-only. A manually set priority other than the
auto-applied `low` is never overwritten; the auto `low` stays re-evaluatable so
labels arriving in a later event can upgrade it.

## 4. Area — on pull requests

Workflow: `PR · Auto-label` (`pr-auto-labeler.yml`). Runs on `pull_request_target`.
Adds `area::*` labels from the changed file paths (`src/loader/` → `area::loader`,
`runtime/` → `area::runtime`, `host/` → `area::contract`, and so on) plus a
`type::*` label from the PR title tag. Existing labels are preserved — the job
only adds.

## Control labels

- `keep-open` — exempt from stale automation.
- `needs-info` — waiting on the reporter.
- `needs-decision` — open question for a maintainer.
- `stale` — no recent activity.
