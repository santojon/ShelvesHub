# Release announcements

Community post copy for each release — Reddit first, reusable for Discord.
This is *not* the changelog: [CHANGELOG.md](../CHANGELOG.md) is the complete,
per-change technical record and [RELEASE_NOTES.md](../RELEASE_NOTES.md) is the
user-facing summary linked from the About page. This file is shorter, punchier,
and written to be read in a feed, not a diff.

## When to write one

Draft the post under `## [Unreleased]` (below) as a release's CHANGELOG.md /
RELEASE_NOTES.md entries firm up — the same section the version-bump workflow
promotes to a dated entry, so it just needs to be there by the time a release
ships. Reuse the wording — don't reinvent the voice release to release. The
post-release workflow builds a ready-to-post Reddit link from this file and
posts the Discord embed from the release body.

## Template

```
ShelvesHub vX.Y.Z is here!

ShelvesHub X.Y.Z is now available.

This release focuses on <one-sentence theme — the 2-3 things a returning
user would actually notice>:

<emoji> <Bold-ish short label> — <one line, plain language, no jargon>
<emoji> <Bold-ish short label> — <one line>
...
<emoji> A collection of fixes and polish for <2-4 areas touched>.

📖 Full release notes:
https://github.com/santojon/ShelvesHub/blob/main/RELEASE_NOTES.md

💬 Community & support

🔵 Discord: https://discord.gg/EChuVEDakk
🟠 Reddit: https://www.reddit.com/r/DeckShelves/
🌐 Website: https://santojon.github.io/ShelvesHub/

Thanks to everyone testing ShelvesHub, reporting bugs and suggesting
improvements. ❤️

ShelvesHub — run Deck Shelves on any Steam client.
```

**Rules for the highlight bullets:**
- Source them from RELEASE_NOTES.md's "Added"/"Changed" entries for the
  release, not CHANGELOG.md — condense further, don't just re-wrap.
- One emoji per bullet, chosen for what the line is about (not decorative).
- Plain language over feature names.
- Bug fixes are always one combined bullet ("a collection of fixes and polish
  for…"), never itemized — that's what RELEASE_NOTES.md is for.
- Keep it to what a returning user would notice in five seconds of scrolling.
- Describe running alongside another host in neutral terms — never name a
  specific third-party plugin host.

## Posts

Same `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` flow as CHANGELOG.md /
RELEASE_NOTES.md: write the draft post for the next release under
`## [Unreleased]` as its highlights firm up, and the version-bump workflow
promotes it to a dated `## [X.Y.Z]` entry the same way it promotes those two
files — same `awk` extraction, same non-fatal skip when `[Unreleased]` is empty
(the post-release job then falls back to the raw release body for that version).
Headings use the bracketed `## [X.Y.Z]` format on purpose, to stay extractable
by the identical pattern.

## [Unreleased]

```
Introducing ShelvesHub!

ShelvesHub 0.1.0 is now available — the first public release.

ShelvesHub is a small background service that runs Deck Shelves for you, so your
custom home-screen shelves are there every time Steam starts:

🚀 Runs Deck Shelves on its own — no plugin loader required. Install ShelvesHub,
start Steam, and your shelves are there.

📦 Brings its own copy of Deck Shelves — if it isn't already on the machine, the
service fetches it and keeps it current on your chosen channel.

🗄️ Hosts the data backend too — settings, backups and friends are supervised and
restarted on crashes, with logs in one place.

🤝 Plays nice with another host — if Deck Shelves is already loaded by a
different host on the same machine, ShelvesHub steps aside instead of loading it
twice.

🎛️ A native Quick Access tab — real Steam buttons, toggles and a gamepad focus
ring, with a status panel, configuration, logs and troubleshooting.

🖱️ One-click and double-click installers — SteamOS, Linux, macOS and Windows,
each with a matching icon, plus clean uninstallers.

🔄 Updates itself — downloads and verifies a newer ShelvesHub, swaps its own
binary in, and restarts the service to finish.

📖 Full release notes:
https://github.com/santojon/ShelvesHub/blob/main/RELEASE_NOTES.md

💬 Community & support

🔵 Discord: https://discord.gg/EChuVEDakk
🟠 Reddit: https://www.reddit.com/r/DeckShelves/
🌐 Website: https://santojon.github.io/ShelvesHub/

Thanks to everyone testing ShelvesHub, reporting bugs and suggesting
improvements. ❤️

ShelvesHub — run Deck Shelves on any Steam client.
```
