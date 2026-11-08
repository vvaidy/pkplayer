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
npm run dist:win      # Windows: x64 NSIS .exe   (works from a Mac, no Wine needed)
npm run dist:linux    # Linux: x86_64 .AppImage  (works from a Mac)
```

Output goes to `dist/`, named `PK-Player-<version>-<os>-<arch>.<ext>`. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to stop electron-builder looking for a signing certificate in your keychain.

## Build and release with GitHub Actions

`.github/workflows/build.yml` builds on GitHub's own Mac, Windows and Linux machines, so every platform is built natively.

| Trigger | What happens |
| --- | --- |
| Push to `main`, or a pull request | Unit tests, then installers for all three platforms. Download them from the run page → **Artifacts** (kept 14 days). |
| Push a tag `v1.2.3` | Same, then a **draft** GitHub Release named *PK Player 1.2.3* with all installers attached and auto-generated notes. |
| Actions tab → build → **Run workflow** | Manual run of the above for any branch. |

### One-time setup

```bash
gh repo create pkplayer --private --source . --push
```

(or create the repository on github.com, `git remote add origin …`, `git push -u origin main --tags`). No secrets are needed for unsigned builds.

### Cutting a release

```bash
npm version 1.1.0            # updates package.json, commits, tags v1.1.0
git push --follow-tags
```

The workflow refuses to release if the tag doesn't match `package.json`'s version. When it finishes, open the repository's **Releases**, review the draft, and click **Publish**. Share the release page link with users; [Installing PK Player](06-installing.md) tells them which file to pick.

## Code signing (optional, later)

Unsigned builds work but trigger the first-launch warnings described in [Installing](06-installing.md#first-launch-warnings). To remove them:

- **macOS** — an Apple Developer ID (Apple Developer Program, USD 99/year). Add repository secrets `CSC_LINK` (base64 .p12 of the *Developer ID Application* certificate), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; set `"notarize": true` under `build.mac` in `package.json`; and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the workflow.
- **Windows** — an OV/EV code-signing certificate or Azure Trusted Signing; electron-builder supports both via `build.win` options and secrets.

## Project layout

| Path | What |
| --- | --- |
| `main.js` | Main process: windows, `app://` protocol, IPC, menus, display selection. |
| `preload.cjs` | The bridge (`window.pk`) between pages and the main process. |
| `src/main/store.js` | Events, settings and the PDF library on disk. |
| `src/lib/player-controller.js` | Pure timing state machine (waiting / playing / paused / ended). |
| `src/renderer/` | Editor and player pages; pdf.js rendering in `pdf.js`. |
| `test/unit/`, `test/e2e/` | Unit and end-to-end tests. |
| `scripts/make-fixtures.js` | Test PDFs. |
| `scripts/make-demo-decks.js` | The demo decks in `samples/demo/`. |
| `scripts/capture-docs-screens.js` | Regenerates the screenshots in `docs/manual/img/` (opens fullscreen windows). |
| `build/icon.svg`, `build/icon.png` | App icon source and the 1024 px PNG electron-builder converts per platform. |
