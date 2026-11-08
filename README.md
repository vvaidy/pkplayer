# PK Player

PechaKucha PDF player. Build an **Event** (time per slide, max slides, playlist of PDFs), hit **Play**, and each deck runs fullscreen on a fixed timer.

## Install / run

- Packaged Mac app: open `dist/PK Player-1.0.0-arm64.dmg` (Apple Silicon) or `dist/PK Player-1.0.0.dmg` (Intel). The app is unsigned, so the first launch needs right-click → Open.
- From source: `npm install`, then `npm start`.

## Editor

- **+ New** creates an Event (defaults: 20 s per slide, 20 max slides).
- Drop PDFs onto the playlist (at the drop position), onto an event in the sidebar, or anywhere in the window. With no event selected, dropping creates a new one. You can also use **Add PDFs…** (⌘O).
- PDFs are copied into the app's library, so moving or deleting the originals is safe (File → Reveal Library Folder).
- To reorder, drag rows, use the ↑/↓ buttons, or press ⌥↑/⌥↓ on a focused row. To remove a row, use ✕ or press Delete.
- Rows show page count, a warning when a deck has more pages than Max Slides, and that deck's run time.
- **Present on** chooses which display goes fullscreen.
- Play options: **Play** (or **F**), ▶ on a row to start from that PDF, or Enter on a focused row.

## Player keys

| Key | Action |
| --- | --- |
| Space / Enter / click | Start the deck from the big Play button |
| Space | Pause / resume |
| → / ← | Next / previous slide (restarts that slide's timer) |
| N | Skip to the next PDF (waits on its Play button) |
| Esc, X, Delete | Stop and return to the editor |
| F | Re-enter fullscreen |

Each deck plays `min(pages, Max Slides)` slides and then stops on the next deck's Play button. Pages beyond Max Slides are skipped. After the last deck it shows "End of event". If you stop mid-event, the editor offers **Play from #N** to restart at that PDF. Timing is deadline-based, so it doesn't drift; measured at ±10 ms per slide. Display sleep is blocked while the player is open.

## Development

```bash
npm test                 # unit tests (headless)
npm run test:e2e         # Electron end-to-end tests — OPENS FULLSCREEN WINDOWS on your displays
npm run fixtures         # regenerate samples/ test PDFs
npm run dist             # build Mac DMG + zip into dist/
```

To run the e2e suite against the packaged app, set `PK_E2E_EXECUTABLE="dist/mac-arm64/PK Player.app/Contents/MacOS/PK Player"`.
Debug logging: `PKPLAY_DEBUG=1 npm start`. Use `PKPLAY_DATA_DIR=/some/dir` for an isolated data folder.

Layout: `main.js` (main process, `app://` protocol, IPC), `preload.cjs` (bridge), `src/main/store.js` (persistence), `src/lib/player-controller.js` (pure timing state machine), `src/renderer/` (editor + player UI, pdf.js).
