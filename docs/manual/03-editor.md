# The editor

The editor is the window you see when PK Player opens. Left: your events and the display picker. Right: the selected event.

![Editor overview](img/02-event.png)

## Events

An **Event** has a name, two settings (with a Format shortcut for them), and a playlist of PDFs. Events are saved automatically as you edit — there is no Save button.

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

**Format** sets both values in one step:

| Format | Time per slide | Max slides |
| --- | --- | --- |
| PechaKucha | 20 sec | 20 |
| Ignite | 15 sec | 20 |
| Custom | whatever you type | whatever you type |

Format always shows what the two settings currently are. If you change either setting by hand to something that matches no format, it switches to **Custom**. Choosing Custom yourself changes nothing; it puts the cursor in Time per slide so you can type.

Under the settings, the summary shows **PDFs · slides that will actually play · total slide time**, plus a yellow count of decks that need a look (see [Playlist](#playlist)). The total excludes the pauses on each Play button, so allow a little more on the night.

## Playlist

Each row shows, from left: drag handle, position, first-page thumbnail, file name, optional presenter, title and page-range fields, and badges.

### Presenter and talk title

Under the file name each row has two fields, **Presenter** and **Talk title**. Both are optional. When either is filled in, the player shows it in large type on that deck's Play screen, in place of the file name.

- Click a field and type. **Enter** or clicking elsewhere saves; **Esc** puts back what was there.
- Empty a field to remove it. Leave both empty and the Play screen shows the file name, as before.
- When you add a PDF, PK Player fills these in from the PDF's own Title and Author properties if they look like real ones. Placeholders such as "PowerPoint Presentation" or "Microsoft Office User", account-style names such as `jsmith42`, and titles that just repeat the file name are ignored. **Check what was filled in**: it comes from the presenter's software, and it will be on the big screen.
- Defaults are only applied when a PDF is added. Clearing or changing a field is never undone later.

### Page range

After the name fields, each row has **pages [ 1 ] – [ end ]**: the first and last page of the PDF that this deck plays. Leave both empty and the deck plays from page 1, as it always has.

- **Skip a title page:** type `2` in the first box. The deck then starts at page 2.
- **Drop a closing page:** type the last page you want in the second box.
- **Max slides still applies.** With Max slides at 20, a first page of `2` plays pages 2–21, even if the PDF is longer.
- The file is never changed. The range is a setting on this row, so the same PDF can play differently in another event.
- Press **Enter** to save, **Esc** to put back what was there. Empty a box to remove that limit.
- A row with a range shows a badge such as `plays pages 2–21`. The [reader](#reader) dims the pages outside it.

Values that make no sense are refused with a message: anything that is not a whole number, or a last page before the first. A first page beyond the end of the PDF is accepted but shown in red, because nothing would play.

### Badges

| Badge | Meaning |
| --- | --- |
| `20 pages` | Pages in the PDF. |
| `only first 20 play` (yellow) | The PDF has more pages than Max slides; the rest are skipped. With a page range it reads `only pages 2–21 play`. |
| `plays pages 2–21` | The deck has a [page range](#page-range) and all of it fits within Max slides. |
| `starts at page 30, past the end — nothing plays` (red) | The page range begins after the PDF's last page. The player skips this deck. |
| `only 17 slides` (yellow) | The PDF has fewer pages than Max slides, so this deck will end early. Shown only when Format is PechaKucha or Ignite. Under Custom, Max slides is just an upper limit and short decks are normal. |
| `4:3, most are 16:9` (yellow) | The page shape differs from most other decks in this event, so this deck will show black bars that the others don't. |
| `6:40` | How long this deck will run. |
| `Cannot read this PDF — it will be skipped` (red) | The file is damaged or not really a PDF. The player skips it. |

When any row has a yellow or red badge, the summary under the settings adds a count in yellow, e.g. **2 decks need a look**. Nothing is blocked: you can still play the event.

The shape check looks at the first page of each PDF and compares decks with each other, not with your display. It only speaks up when one shape is clearly the most common: with one 16:9 deck and one 4:3 deck, neither is flagged.

Row buttons (they brighten when you hover): the **page icon** opens the deck in the [reader](#reader), **▶** plays from this PDF, **↑ / ↓** move, **✕** removes.

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

## Reader

The reader opens a PDF in an ordinary window for reading, not presenting. Use it to look through a whole deck: the playlist only shows page 1, and the player only shows the pages that will play.

![The reader window with thumbnails and a search](img/13-reader.png)

**To open it**

- Click the page icon on a playlist row, or double-click the row's thumbnail.
- Or choose **File → Open PDF in Reader…** (⇧⌘O / Ctrl+Shift+O) for any PDF on your computer. That file is not added to an event and not copied.

**What it does**

| To | Do this |
| --- | --- |
| Move through pages | Scroll, press **→ / ←** or Page Down / Page Up, **Home** / **End**, type a page number, or click a thumbnail. |
| Zoom | **+** and **−** buttons (⌘+ / ⌘−), the zoom menu (**Fit width**, **Fit page**, 50% to 400%), or pinch on a trackpad. ⌘0 goes back to Fit width. |
| Hide the thumbnails | Click **Pages**. |
| See every page at once | Click **Grid** or press **G**. Click a page to open it; **Esc** goes back to where you were. |
| Find text | ⌘F, type, and press **Enter** for the next match (Shift+Enter for the previous; ⌘G and ⇧⌘G also work). Matches are highlighted, and thumbnails show how many each page has. **Esc** clears the search. |
| Copy text | Select it with the mouse and press ⌘C. |

![The reader's grid view of a deck with more pages than Max slides](img/14-reader-grid.png)

Things to know:

- Reading never changes a file. The one thing that does is [Edit pages](#editing-a-decks-pages), and only when you save.
- Every page of the PDF is shown, including pages the event will not play: those beyond Max slides and those outside the deck's [page range](#page-range). When you open a deck from the playlist, those pages are dimmed and labelled **not played** in the thumbnails and the grid, and the grid says which pages the event will play. A PDF opened from the File menu belongs to no event, so nothing is marked.
- Search finds text that is real text in the PDF. Words that are part of a picture are not found, and a phrase that breaks across two lines is not found as one match.
- You can have several reader windows open. They close when you close the main window.

## Editing a deck's pages

When a deck needs more than a [page range](#page-range) can do, you can remove, reorder and rotate its pages.

1. Open the deck in the [reader](#reader) from its playlist row and click **Grid**.
2. Click **Edit pages…**. Each page gets four buttons: **←** and **→** move it, **↻** turns it a quarter turn, **✕** removes it (and **Keep** brings it back). You can also drag a page onto another to move it there.
3. A line at the top says what will change, for example *1 page removed, 1 rotated, order changed · 19 pages will remain*.
4. Click **Save changes**, or **Cancel** (or **Esc**) to leave everything as it was.

![Editing a deck's pages in the reader's grid](img/15-edit-pages.png)

**Keep only the pages that play** removes every page the event would not show, which trims an over-long deck to Max slides in one click. **Undo all** puts every page back before you save.

What happens to the files:

- **The presenter's file is never touched.** PK Player works on its own copy in the library.
- **Saving writes a new copy** with your changes and keeps the copy the deck was added with. **Restore original pages**, in the grid, goes back to it at any time, however many edits you have saved.
- Saving clears the deck's page range, because its page numbers would now point at different pages. Set it again if you still want one.
- Only this row changes. If you duplicated the event, the other event's deck is unaffected.
- A password-protected PDF cannot be edited; PK Player says so and changes nothing.
- A PDF opened with **File → Open PDF in Reader…** has no Edit pages button, because it belongs to no event.

Editing pages keeps each page exactly as it is drawn. It cannot change the text or pictures on a page.

## Exporting an event as one PDF

**File → Export Event as One PDF…** writes a single PDF of everything the selected event plays, in playlist order: each deck's page range, capped by Max slides. Pages that would not play are left out. Use it for a backup, to hand the whole night to someone, or to check the running order in any PDF viewer.

Decks that cannot be read are left out, and the message tells you how many. Your events and decks are not changed.

## Speedrun test

**Speedrun test…** (above the playlist, and in the File menu) plays every slide of every deck in the event fast, fullscreen on the display you chose, so you can see that everything loads and displays before the night.

- A dialog asks first. Choose **5×**, **10×** or **20×** and click **Start test**. It shows how long each choice will take. Cancel is the default button.
- Each deck's Play screen shows for a second, then the deck starts by itself. You don't press anything.
- A yellow **SPEED TEST 10× — not a real run** bar stays across the top of the screen the whole time.
- Each slide is given its time only once it has finished drawing, so a slow or broken page can't slip past.
- At the end a report says **Speedrun passed**, or lists what went wrong: a PDF that could not be opened, a slide that could not be drawn, or a slide that took more than 10 seconds.
- **Space** pauses so you can look at a slide, the arrow keys and **N** skip, and **Esc** stops. Skipping means the report will say some slides were not shown.

**It cannot be left on.** The speed belongs to that one test run. It is never saved, the dialog always opens on 10×, there is no keyboard shortcut, and there is no slower-than-normal choice. **Play**, **F**, Enter and the row **▶** buttons always run at normal speed. A speedrun also leaves the event's resume point alone.

## Practice a PDF

**File → Practice a PDF…** (⇧⌘P / Ctrl+Shift+P) plays a single PDF with the timer, without creating an event. It is meant for a presenter rehearsing their own talk. The first screen of a fresh install has a **Practice a PDF…** button too.

- Pick a PDF. The player opens on its Play button, exactly as it would on the night, and all the [player keys](04-player.md#keys) work.
- **Timing:** if an event is selected, practice uses that event's Time per slide and Max slides. With no event selected it uses 20 seconds and 20 slides.
- **Nothing is saved.** No event is created, nothing is added to your playlists, and PK Player's working copy of the PDF is removed when you press Esc. Your own file is never changed.
- To rehearse again, choose Practice a PDF… again.

## Present on

The **Present on** menu at the bottom of the sidebar chooses which display the player fills. It lists every connected display with its name and resolution, and updates when you plug or unplug one. The choice is saved; if that display is missing at play time, the main display is used.

## Theme

The **Theme** menu under Present on changes PK Player's colors. The choice is saved and applies to the editor and to the player's own controls: the Play button, its glow, and anything else PK Player draws. Your slides are never tinted.

| Dark | Light |
| --- | --- |
| Midnight Teal (the default) | Paper |
| Blueprint | Sage |
| Aubergine | Blossom |
| Forest | |
| Lagoon | |
| Graphite | |
| Projector (high contrast) | |
| Vibe with Claude | |

- **Vibe with Claude** is the original look of PK Player up to version 1.0.2, kept exactly.
- **Projector** is black and white with one bright accent, for washed-out projectors and bright rooms.
- Every theme was made for PK Player. None is taken from another project's color scheme.
- The yellow and red badges described above use each theme's own warning and error colors, so their exact shade varies.

### Your own themes

**Customize…** under the Theme menu opens the theme editor. The window behind it repaints as you change things, so you see the real result before saving.

![The theme editor with a live preview behind it](img/12-theme-editor.png)

- A theme is a name and six colors: **Background**, **Text**, **Accent** (the Play button and the selection), **Warning**, **Error** and **OK**. PK Player works out every other shade (cards, borders, dim text, hover states) from those six.
- For each color, click the swatch to use your system's color picker, or type a value such as `#2dd4bf`.
- Whether the theme is dark or light follows the background color. There is no separate switch.
- If a color would be hard to read (pale text on a pale background, say), PK Player shows it slightly adjusted and a line in the editor tells you which colors were adjusted. Your own values are what gets saved.
- **Save** keeps the theme and switches to it. **Cancel** or **Esc** puts the previous colors back.

Built-in themes are never changed. Customizing one starts a copy ("Midnight Teal copy") that is saved under **Your themes** at the bottom of the Theme menu. Customizing one of your own themes edits it in place, and the editor then also offers:

- **Delete** removes the theme after asking. If it was in use, PK Player goes back to Midnight Teal.
- **Export…** writes the saved theme to a small `.pkplayer-theme.json` file you can share or keep as a backup.

You can keep up to 100 themes of your own. They are stored with your events (see [Where your data lives](06-installing.md#where-your-data-lives)).

### Importing a theme

**Import…** adds a theme from a file and switches to it. Three kinds of file work:

| File | Where it comes from |
| --- | --- |
| `.pkplayer-theme.json` | **Export…** in PK Player |
| A Ghostty theme file | The Ghostty terminal's `themes` folder, or one you wrote |
| `.itermcolors` | iTerm2's color presets |

From a terminal color scheme PK Player takes the background and text colors, and uses the scheme's blue for the accent, yellow for warnings, red for errors and green for OK. Use **Customize…** afterwards if you would like a different accent.

PK Player does not include any terminal color schemes itself. Importing reads a file that you provide, and the result is stored only on your computer.

