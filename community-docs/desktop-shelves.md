# Experimental: shelves in the desktop client

*[Leia em português](pt-BR/desktop-shelves.md)*

By default ShelvesHub hosts your shelves only while the Steam gamepad / Big
Picture interface is on screen, and stands down in the plain desktop client.
An **experimental** toggle lets you inject into the desktop client too. It's
**off by default** and shown on **macOS and Windows**.

## Why it's off by default

The Home shelves are built for the gamepad interface. In the plain desktop
client they can read wrong and end up placed where a gamepad can't reach them.
So ShelvesHub normally waits for the gamepad / Big Picture UI to be on screen
before hosting, and clears an existing injection when you drop back to the
desktop client, to keep the desktop client clean.

## Turning it on

It's the `desktop_ui` setting (shown as a toggle on macOS/Windows in the
ShelvesHub tab's Configuration section). Turn it on if you specifically want
the shelves to appear in the desktop client too, and accept that this path is
experimental — placement and reachability aren't guaranteed there.

## Troubleshooting

- **Shelves are placed oddly or I can't reach them with a gamepad in the
  desktop client.** That's the exact reason this is experimental and off by
  default — turn `desktop_ui` off to host only in the gamepad / Big Picture
  interface.
- **I turned it on but see nothing change.** Changing it takes a restart;
  use **Restart to apply**.
