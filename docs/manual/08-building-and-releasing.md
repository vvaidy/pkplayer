# Building & releasing

For whoever maintains PK Player.

## Run from source

Needs Node.js 22 or newer.

```bash
npm install
npm start
```

Electron downloads its runtime on first start if it isn't there yet (`npx install-electron --no` fetches it explicitly).

Useful environment variables:

| Variable | Effect |
| --- | --- |
| `PKPLAY_DEBUG=1` | Verbose logging in the terminal and DevTools console. |
| `PKPLAY_DATA_DIR=/some/dir` | Use a separate data folder (also allows a second instance alongside your normal one). |

## Tests

```bash
npm test             # unit tests: timing state machine + storage. Headless, ~1 s.
npm run test:e2e     # Electron end-to-end tests. OPENS FULLSCREEN WINDOWS on your displays (~30 s).
```

To run the end-to-end suite against a packaged app instead of the source tree:

```bash
PK_E2E_EXECUTABLE="dist/mac-arm64/PK Player.app/Contents/MacOS/PK Player" npm run test:e2e
```

## Build installers locally

```bash
npm run dist          # macOS: arm64 + x64 .dmg, arm64 .zip
npm run dist:mac:signed   # the same, signed and notarized (see Code signing below)
npm run dist:win      # Windows: x64 NSIS .exe   (works from a Mac, no Wine needed)
npm run dist:linux    # Linux: x86_64 .AppImage  (works from a Mac)
```

Output goes to `dist/`, named `PK-Player-<version>-<os>-<arch>.<ext>`. If a Developer ID certificate is in your keychain, `npm run dist` signs with it automatically but does not notarize. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` for an unsigned build.

## Build and release with GitHub Actions

`.github/workflows/build.yml` builds on GitHub's own Mac, Windows and Linux machines, so every platform is built natively.

| Trigger | What happens |
| --- | --- |
| Push to `main`, or a pull request | Unit tests, then installers for all three platforms. Download them from the run page → **Artifacts** (kept 14 days). The Mac build is unsigned, to keep these runs quick. |
| Push a tag `v1.2.3` | Same, but the Mac build is **signed and notarized**. Then a **draft** GitHub Release named *PK Player 1.2.3* is created with all installers attached and auto-generated notes. |
| Actions tab → build → **Run workflow** | Manual run for any branch. Tick **Sign and notarize the Mac build** to get a signed Mac app. |

### One-time setup

```bash
gh repo create pkplayer --private --source . --push
```

(or create the repository on github.com, `git remote add origin …`, `git push -u origin main --tags`). Signed Mac builds also need the repository secrets described under [Code signing](#code-signing).

### Cutting a release

```bash
npm version 1.1.0            # updates package.json, commits, tags v1.1.0
git push --follow-tags
```

The workflow refuses to release if the tag doesn't match `package.json`'s version. When it finishes, open the repository's **Releases**, review the draft, and click **Publish**. Share the release page link with users; [Installing PK Player](06-installing.md) tells them which file to pick.

## Code signing

### macOS

Mac release builds are signed as *Developer ID Application: Vijay Vaidyanathan (PE2UT44344)* and notarized by Apple, so they open without Gatekeeper warnings.

**In GitHub Actions** (how releases are built), signing uses five repository secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | The Developer ID Application certificate and private key, exported as a .p12 and base64-encoded |
| `CSC_KEY_PASSWORD` | The password chosen when exporting the .p12 |
| `APPLE_ID` | The Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID, from account.apple.com |
| `APPLE_TEAM_ID` | `PE2UT44344` |

To set or replace them, export the certificate from Keychain Access (login → My Certificates → right-click *Developer ID Application: …* → Export → .p12), then run:

```bash
base64 -i ~/Desktop/pkplayer-devid.p12 | gh secret set CSC_LINK --repo vvaidy/pkplayer
gh secret set CSC_KEY_PASSWORD --repo vvaidy/pkplayer
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo vvaidy/pkplayer
```

Each `gh secret set` without a value prompts for it. Delete the exported .p12 afterwards, or keep it somewhere safe as your backup.

If a secret is missing, a tag build fails rather than producing an unsigned Mac release. After signing, the workflow checks the app with `spctl` and `stapler`, and fails if either check fails.

**On your own Mac:** run `npm run dist:mac:signed`. This needs two things in the login keychain:

- The Developer ID Application certificate and its private key. `security find-identity -v -p codesigning` should list it.
- A notarytool profile named `pkplayer-notary`, made once with `xcrun notarytool store-credentials pkplayer-notary --apple-id YOUR_APPLE_ID --team-id PE2UT44344`.

To check a build:

```bash
spctl -a -vvv -t exec "dist/mac-arm64/PK Player.app"   # expect: source=Notarized Developer ID
xcrun stapler validate "dist/mac-arm64/PK Player.app"  # expect: The validate action worked!
```

Notarization uploads each app to Apple and waits for approval: about 4 minutes per architecture, sometimes longer.

**Renewal:** the certificate expires on 2027-12-12. Before then, create a new one at developer.apple.com → Certificates, Identifiers & Profiles, then update `CSC_LINK` and `CSC_KEY_PASSWORD`. Apps signed before it expires keep working. The Apple Developer Program membership itself renews yearly.

### Windows

The Windows build is unsigned, so SmartScreen warns on first launch. Signing it needs an OV/EV code-signing certificate or Azure Trusted Signing; electron-builder supports both through `build.win` options and secrets.

## Project layout

| Path | What |
| --- | --- |
| `main.js` | Main process: windows, `app://` protocol, IPC, menus, display selection. |
| `preload.cjs` | The bridge (`window.pk`) between pages and the main process. |
| `src/main/store.js` | Events, settings and the PDF library on disk. |
| `src/lib/presets.js` | The Format presets (PechaKucha, Ignite). |
| `src/lib/preflight.js` | Deck warnings: short decks and odd page shapes. |
| `src/lib/themes.js` | The color themes and the math that derives each theme's full palette. `src/renderer/theme.js` applies one to a window. |
| `src/lib/deck-label.js` | What the Play screen says about a deck; default presenter and title from PDF properties. |
| `src/lib/player-controller.js` | Pure timing state machine (waiting / playing / paused / ended). |
| `src/renderer/` | Editor and player pages; pdf.js rendering in `pdf.js`. |
| `test/unit/`, `test/e2e/` | Unit and end-to-end tests. |
| `scripts/make-fixtures.js` | Test PDFs. |
| `scripts/make-demo-decks.js` | The demo decks in `samples/demo/`. |
| `scripts/capture-docs-screens.js` | Regenerates the screenshots in `docs/manual/img/` (opens fullscreen windows). |
| `build/icon.svg`, `build/icon.png` | App icon source and the 1024 px PNG electron-builder converts per platform. |
