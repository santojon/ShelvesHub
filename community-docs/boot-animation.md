# Optional boot animation

*[Leia em português](pt-BR/boot-animation.md)*

ShelvesHub can play a short Deck Shelves startup animation when Steam launches.
It's **off by default** and entirely optional — a bit of personality on boot,
nothing more.

## How it works

It uses Steam's **own** startup-movie feature rather than drawing an overlay:
turning the toggle on installs the animation into Steam's startup-movie slots,
and turning it off removes it. Because Steam only reads the movie at its next
start, toggling it surfaces the **Restart to apply** button (which restarts
Steam so the animation replays).

Two source cuts ship — a Deck-native 1280×800 cut for the Steam Deck's panel
and a 1080p cut for desktop — and ShelvesHub picks the right one for your
device. On desktop, the animation plays on **Big Picture entry**, not on plain
desktop-client launch.

## Turning it on or off

It's a live toggle in the ShelvesHub tab's Configuration section (the
`boot_movie` setting):

- **On** — installs the animation immediately; press **Restart to apply** to
  see it on the next Steam start.
- **Off** — removes it immediately.

## Troubleshooting

- **It didn't play.** Make sure you restarted Steam after enabling it — the
  movie is only read at Steam's next start. On desktop, enter Big Picture to
  see it.
- **I turned it off but want it gone completely.** Turning the toggle off
  removes the installed animation files; a restart shows Steam's default boot
  again.
