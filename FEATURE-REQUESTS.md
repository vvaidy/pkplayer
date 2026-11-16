# Feature requests

Ideas that have been discussed and are not built. Nothing here is promised or scheduled.

## Open

### Event export and import

Save an event, with its settings, playlist and PDFs, as one file, and open that file on another computer.

- **Why:** a backup laptop for the night; handing an event to a co-organizer; moving to a new machine without copying the whole data folder.
- **What exists today:** *File → Export Event as One PDF…* writes the pages an event plays as a single PDF, which covers the "have a backup" case but loses the playlist, names, titles and timing. Copying the whole `data` folder moves everything at once (see [Where your data lives](docs/manual/06-installing.md#where-your-data-lives)).
- **Open questions:** the file format; what to do when an imported event has the same name as an existing one; whether custom themes travel with it.

### Operator view

When a projector is connected, show a second window on the laptop with the slide on screen, the next slide, the time left on this slide, and the next presenter.

- **Why:** the person running the night currently sees only what the audience sees.
- **Why it has waited:** it means reworking how the player window goes fullscreen, which is the most delicate part of the app, and it can only be tested with two displays attached.
- **Open questions:** whether the operator window also carries the controls; what it shows on the Play screen between decks.

## Not planned

- **Annotations saved into a PDF** (highlights, ink, notes). Preview and other PDF apps already do this well.
- **Editing the text or layout of a page.** This is a different kind of application, and a partial version would risk damaging decks.
