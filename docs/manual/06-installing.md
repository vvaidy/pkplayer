# Installing PK Player

PK Player runs on macOS, Windows and Linux. Pick the file for your computer from the release:

| Computer | File |
| --- | --- |
| Mac with Apple silicon (M1 or later) | `PK-Player-<version>-mac-arm64.dmg` |
| Mac with Intel processor | `PK-Player-<version>-mac-x64.dmg` |
| Windows 10/11 (64-bit) | `PK-Player-<version>-win-x64.exe` |
| Linux (64-bit) | `PK-Player-<version>-linux-x86_64.AppImage` |

Not sure which Mac you have?  → About This Mac: *Chip: Apple M…* means Apple silicon; *Processor: Intel…* means Intel.

> [!WARNING]
> **Only tested on one Mac.** PK Player has been run and tested only on a Mac with Apple silicon (M4 Max) running macOS 26.6.2 (Tahoe). The Intel Mac, Windows and Linux versions are built automatically but have **never been run or tested**. They may not work at all.

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

**macOS:** the Mac versions are signed with an Apple Developer ID and notarized by Apple, so PK Player opens like any other app. The first time, macOS asks *"PK Player" is an app downloaded from the internet. Are you sure you want to open it?* Click **Open**.

If macOS instead says it *could not verify* PK Player, or that it *is damaged and can't be opened*, you have an unsigned copy, such as one built from source. Download the current release, or let it run:

- **macOS 15 Sequoia and later:** open PK Player and click **Done**. Then go to System Settings → **Privacy & Security**, scroll down to *"PK Player" was blocked…*, click **Open Anyway**, and confirm with your password.
- **macOS 14 and earlier:** right-click (Control-click) PK Player in Applications → **Open** → **Open**.
- **"Damaged":** the app isn't damaged. In Terminal, run:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/PK Player.app"
  ```

**Windows:** the Windows version isn't code-signed, so SmartScreen shows *Windows protected your PC* the first time. Click **More info** → **Run anyway**.

**Linux:** no warning.

## Where your data lives

Events and the copied PDFs are stored in:

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/PK Player/data` |
| Windows | `%APPDATA%\PK Player\data` |
| Linux | `~/.config/PK Player/data` |

Inside: `events.json` (events, settings and your own themes) and `library/` (PDF copies). To back up or move to another computer, quit PK Player and copy the whole `data` folder. File → **Reveal Library Folder** opens `library/`.

Updating PK Player doesn't touch this folder. Uninstalling doesn't delete it either; remove it by hand if you want a clean slate.
