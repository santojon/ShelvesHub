# Boot animation

A short startup animation (chaos → alignment → organization → identity) in the
visual language of the Steam Machine boot: pure black background, flat
square-cornered shapes, white and Steam blue only. It closes on a spin that
seals a single ring and reveals the Steam mark.

Palette: `#0080FF` · `#0044B0` · `#FFFFFF` · `#D2D2D2` · background `#000000`.

## Files

| File | Use |
|---|---|
| `deck_startup.webm` | 1920×1080 · 60 fps · VP9 — primary |
| `deck_startup_1280x800.webm` | Steam Deck native resolution (16:10) |
| `generate_boot_movie.py` | Render source (numpy + PIL + scipy + ffmpeg) |

The `.mp4` H.264 preview is intentionally not shipped — WebM/VP9 is what Steam
plays; the MP4 is only a quick desktop preview.

## How it plays

This is Steam's own **startup movie** (the boot animation the Deck UI plays on
launch), not an overlay the host renders. Steam plays a WebM placed at, per
platform:

- Linux / Steam Deck: `~/.steam/root/config/uioverrides/movies/deck_startup.webm`
- macOS: `~/Library/Application Support/Steam/config/uioverrides/movies/deck_startup.webm`
- Windows: `<Steam install>\config\uioverrides\movies\deck_startup.webm`

The host installs it there when its **boot movie** option is on, and removes it
when off (see `src/bootmovie.rs`). It can also be set manually in Game Mode →
Settings → Customization → Startup Movie.

## Regenerate

```bash
pip install numpy pillow scipy   # ffmpeg on PATH for encoding
python3 generate_boot_movie.py   # preview frames → $BOOT_PREVIEW_DIR (temp dir)
```

Geometry is in the SVG's own coordinates (`ARC_C`, `CIR_C`, `SHELF_*`, `BOOKS`,
`B5`), mapped through `K`, `PX()`, `PY()`. Timing lives in the `T_*` constants;
`SPIN` controls the closing spin. The final Steam valve is rasterized from the
`steam.svg` icon of the [simple-icons](https://github.com/simple-icons/simple-icons)
project (CC0 files; the Steam mark itself is Valve's), embedded in the script as
a base64 mask (`VALVE_B64`).
