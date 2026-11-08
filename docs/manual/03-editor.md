# The editor

The editor is the window you see when PK Player opens. Left: your events and the display picker. Right: the selected event.

![Editor overview](img/02-event.png)

## Events

An **Event** has a name, two settings, and a playlist of PDFs. Events are saved automatically as you edit — there is no Save button.

| Action | How |
| --- | --- |
| Create | **+ New** in the sidebar, **+ New Event** on the empty screen, File → New Event, or ⌘N / Ctrl+N. Dropping PDFs when no event is selected also creates one. |
| Rename | Click the name at the top and type. Enter or Esc finishes. |
| Switch | Click an event in the sidebar. Each one shows its PDF count and settings, e.g. `4 PDFs · 20s × 20`. |
| Duplicate | **Duplicate** (top right). Copies settings and playlist; the copy is named "… copy". PDFs are shared, not copied again. |
| Delete | **Delete** (top right), then confirm. PDFs used by no other event are removed from the library. |

## Settings

![Event settings](img/03-settings.png)

| Setting | Default | Allowed | Meaning |
| --- | --- | --- | --- |
| Time per slide | 20 sec | 1–3600 | How long each slide stays on screen. |
| Max slides | 20 per PDF | 1–999 | The most pages any PDF in this event may show. Later pages are skipped. |

Change a value and press Enter or click elsewhere. An out-of-range value shakes, shows an error and reverts.

Next to the settings, the summary shows **PDFs · slides that will actually play · total slide time**. The total excludes the pauses on each Play button, so allow a little more on the night.

## Playlist

Each row shows, from left: drag handle, position, first-page thumbnail, file name, and badges:

| Badge | Meaning |
| --- | --- |
| `20 pages` | Pages in the PDF. |
| `only first 20 play` (yellow) | The PDF has more pages than Max slides; the rest are skipped. |
| `6:40` | How long this deck will run. |
| `Cannot read this PDF — it will be skipped` (red) | The file is damaged or not really a PDF. The player skips it. |

Row buttons (they brighten when you hover): **▶** play from this PDF, **↑ / ↓** move, **✕** remove.

### Adding PDFs

- Drop files on the playlist — they're inserted where you drop them (a glowing line shows the spot).
- Drop files anywhere else in the window — they're added at the end.
- Drop files on an event in the sidebar — they're added to that event.
- **Add PDFs…** or ⌘O / Ctrl+O opens a file picker.

You can add many files at once. Files that aren't PDFs are rejected with a message naming each one. PK Player checks the file's contents, not just its extension.

Added PDFs are **copied** into PK Player's library, so the originals can be moved, renamed or deleted. File → **Reveal Library Folder** shows the copies.

### Reordering and removing

- Drag a row to a new position.
- Use the row's ↑ / ↓ buttons.
- Keyboard: click a row, then ↑ / ↓ moves the focus, ⌥↑ / ⌥↓ (Alt+↑ / Alt+↓) moves the PDF, Delete or Backspace removes it, Enter plays from it.

## Playing

| Control | Starts |
| --- | --- |
| **Play** button or **F** | From deck 1 — or, after you stopped mid-event, from the deck you stopped on. |
| **Play from #N** | Shown after stopping mid-event: restarts at deck N, slide 1. |
| **From start** | Shown next to **Play from #N**: always deck 1. |
| Row **▶** or Enter on a row | From that deck. |

The resume point is kept until you quit the app.

## Present on

The **Present on** menu at the bottom of the sidebar chooses which display the player fills. It lists every connected display with its name and resolution, and updates when you plug or unplug one. The choice is saved; if that display is missing at play time, the main display is used.
