# Troubleshooting & FAQ

## Display and fullscreen

**The player opened on the laptop instead of the projector.**
Press Esc, choose the projector in **Present on** (bottom of the sidebar), then **Play from #N**. If the projector isn't in the list, check it's connected and that displays are set to *extend*, not mirror.

**The projector isn't listed.**
The list updates when displays connect. Check the cable and the OS display settings. If the OS mirrors displays, there is only one display to pick — switch to extended.

**The player isn't fullscreen any more.**
Press **F**.

**Black bars around the slides.**
The deck's shape (e.g. 4:3) doesn't match the screen (e.g. 16:9). Slides are never cropped or stretched. Ask for a 16:9 export — see [Preparing decks](05-preparing-decks.md).

**The screen went to sleep / screensaver started.**
It shouldn't while the player is open — PK Player blocks display sleep until you exit. In the editor, normal power settings apply.

## Decks

**A row says *Unreadable PDF*.**
The file is damaged, password-protected, or not actually a PDF. Re-export it. The player skips unreadable decks rather than stopping the event.

**"Skipped: Not a PDF file" when adding.**
PK Player checks file contents. A file renamed to `.pdf` (or an HTML error page saved from a download link) is rejected.

**A deck shows fewer slides than expected.**
Check the **Max slides** setting and the deck's page count. A yellow badge appears when a deck has more pages than will play.

**A deck shows more slides than the presenter made.**
The export probably included build stages, notes pages or hidden slides. See [Preparing decks](05-preparing-decks.md#exporting-a-pdf).

**Slides look blurry.**
Usually the images in the PDF are low resolution. Vector content (text, shapes) is always sharp.

**Animations, videos or sounds are missing.**
PK Player plays PDFs, which are still images. This is by design.

## Playback

**A slide moved on before the presenter was ready.**
That's PechaKucha. If you need to, press **←** to go back (the slide gets a fresh timer) or **Space** to pause.

**I pressed Esc by accident.**
Click **Play from #N** in the editor. The deck restarts from its first slide; press **→** to catch up.

**I want to start from a particular presenter.**
Click ▶ on their row, or select the row and press Enter.

**Can I show a presenter view / speaker notes?**
No. PK Player shows one fullscreen view.

**Can the timer differ per presenter?**
Not within one event. Put that presenter in a separate event with its own Time per slide.

## Data

**Where are my events stored? How do I back up?**
See [Where your data lives](06-installing.md#where-your-data-lives).

**I moved or deleted the original PDF — is the event broken?**
No. PK Player copied it into its library when you added it.

**I updated a presenter's PDF on disk but the event shows the old one.**
Same reason: the event uses its own copy. Remove the row and add the new file.

**Disk space.**
PDFs not used by any event are deleted from the library when you remove them from playlists or delete events.

## Still stuck?

Start PK Player from a terminal with debug logging on, reproduce the problem, and keep the output:

```bash
# macOS
PKPLAY_DEBUG=1 "/Applications/PK Player.app/Contents/MacOS/PK Player"
```

```bash
# Linux
PKPLAY_DEBUG=1 ./PK-Player-*.AppImage
```

On Windows (PowerShell): `$env:PKPLAY_DEBUG=1; & "$env:LOCALAPPDATA\Programs\PK Player\PK Player.exe"`.
