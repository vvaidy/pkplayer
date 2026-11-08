# Installing PK Player

PK Player runs on macOS, Windows and Linux. Pick the file for your computer from the release:

| Computer | File |
| --- | --- |
| Mac with Apple silicon (M1 or later) | `PK-Player-<version>-mac-arm64.dmg` |
| Mac with Intel processor | `PK-Player-<version>-mac-x64.dmg` |
| Windows 10/11 (64-bit) | `PK-Player-<version>-win-x64.exe` |
| Linux (64-bit) | `PK-Player-<version>-linux-x86_64.AppImage` |

Not sure which Mac you have?  → About This Mac: *Chip: Apple M…* means Apple silicon; *Processor: Intel…* means Intel.

## macOS

1. Open the `.dmg`.
2. Drag **PK Player** into **Applications**.
3. Eject the disk image and open PK Player from Applications.

## Windows

Run the `.exe`. It installs for your user only (no administrator needed), adds Start menu and desktop shortcuts, and launches PK Player. Uninstall from Settings → Apps.

## Linux

```bash
chmod +x PK-Player-*.AppImage
./PK-Player-*.AppImage
```

On Ubuntu 22.04 and later, AppImages need FUSE 2: `sudo apt install libfuse2` (`libfuse2t64` on 24.04).

## First-launch warnings

PK Player isn't code-signed yet, so each operating system asks you to confirm the first time. This is a one-time step.

**macOS 15 Sequoia and later**

1. Open PK Player. macOS says it can't verify the app. Click **Done**.
2. Open System Settings → **Privacy & Security**, scroll down to *"PK Player" was blocked…*, and click **Open Anyway**. Confirm with your password.

**macOS 14 and earlier:** right-click (Control-click) PK Player in Applications → **Open** → **Open**.

**"PK Player is damaged and can't be opened"** — macOS shows this for unsigned apps downloaded from the internet. The app is not damaged. In Terminal, run:

```bash
xattr -dr com.apple.quarantine "/Applications/PK Player.app"
```

**Windows:** SmartScreen shows *Windows protected your PC*. Click **More info** → **Run anyway**.

## Where your data lives

Events and the copied PDFs are stored in:

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/PK Player/data` |
| Windows | `%APPDATA%\PK Player\data` |
| Linux | `~/.config/PK Player/data` |

Inside: `events.json` (events and settings) and `library/` (PDF copies). To back up or move to another computer, quit PK Player and copy the whole `data` folder. File → **Reveal Library Folder** opens `library/`.

Updating PK Player doesn't touch this folder. Uninstalling doesn't delete it either; remove it by hand if you want a clean slate.
