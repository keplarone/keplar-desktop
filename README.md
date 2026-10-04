# Keplar One for desktop

Keplar One is a window onto [keplar.one](https://keplar.one).

One question. Multiple intelligences. One answer.

Sign-in, questions, and answers stay on Keplar's servers. This app does not keep its own copy of them. It does keep a normal browser session for `keplar.one` (cookies and site storage, so you can stay signed in), the window size, Chromium's cache, and any file you explicitly save. Those live in the app's user-data folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Keplar` |
| macOS | `~/Library/Application Support/Keplar` |
| Linux | `~/.config/Keplar` |

The folder stays `Keplar` so an update from an earlier build keeps you signed in. The name you see in the dock, taskbar, and installer is Keplar One.

If that folder is not there, look for `keplar-desktop` next to it. Removing it signs you out on this computer. Uninstalling the app does not always remove it.

## Install

Download a release from [GitHub Releases](https://github.com/keplarone/keplar-desktop/releases). The first builds are unsigned unless a code-signing certificate has been added to the repository secrets. Unsigned apps are safe to run only if you trust this repository. The operating system will warn you, and that warning is expected.

Each release includes `SHA256SUMS`. Check a download with `sha256sum -c SHA256SUMS` (or `Get-FileHash` on Windows) before you open it.

### Windows

File: `Keplar-One-<version>-win-x64.exe`

The installer is an NSIS setup wizard for 64-bit Windows. It is a per-user install unless you change that in the wizard.

SmartScreen will say it prevented an unrecognized app from starting. Choose **More info**, then **Run anyway**.

### macOS

Files:

- `Keplar-One-<version>-mac-arm64.dmg` for Apple silicon
- `Keplar-One-<version>-mac-x64.dmg` for Intel Macs

The `.zip` files next to them are what auto-update uses. Install from the `.dmg`: open it and drag Keplar One to Applications.

Gatekeeper will say the app cannot be opened because the developer cannot be verified, or that it is damaged. Either of these works:

- Right-click `Keplar One.app`, choose **Open**, then **Open** again.
- Or, in Terminal: `xattr -cr "/Applications/Keplar One.app"` and open the app again.

macOS auto-update only works after the app is code-signed and notarized. An unsigned copy will not replace itself. Download the next `.dmg` instead. See [Updates](#updates).

### Linux

Files, all x64:

- `Keplar-One-<version>-linux-x86_64.AppImage`
- `Keplar-One-<version>-linux-amd64.deb`
- `Keplar-One-<version>-linux-x86_64.rpm`

`x86_64` and `amd64` are the same CPU. The names follow the usual names for AppImage, deb, and rpm.

AppImage:

```bash
chmod +x Keplar-One-*-linux-x86_64.AppImage
./Keplar-One-*-linux-x86_64.AppImage
```

Debian or Ubuntu: `sudo apt install ./Keplar-One-*-linux-amd64.deb`

Fedora or RHEL: `sudo rpm -i Keplar-One-*-linux-x86_64.rpm` (or `sudo dnf install ./Keplar-One-*-linux-x86_64.rpm`)

Auto-update applies to the AppImage. deb and rpm installs are updated by installing the next package.

## Signing in

Sign in, Sign up and Add account open your default browser. The app never shows a login form of its own, so Google, Microsoft, e-mail sign-in and magic links work exactly as they do on the website, including password managers and passkeys.

1. In the app, choose **Sign in** (or **Add account**). A small window says it is waiting for your browser and shows a short code such as `K7F-2QM`.
2. Your browser opens a Keplar page with the same code. Sign in there, then choose **Connect Keplar One**. (**Use a different account** switches account first; **This wasn't me** stops it.)
3. The browser hands a one-time code back to the app through the `keplar://auth` link, and the app signs in.

If the system does not pass the `keplar://` link to the app, the app notices the approval on its own within a few seconds. **Cancel** (or closing the small window) stops the request, and the browser page stops working.

How it is kept safe: the app makes a random secret that never leaves it and sends only its SHA-256 hash (PKCE). The one-time code in the link is useless without that secret, works once, and expires after 2 minutes; the whole request expires after 10 minutes. After an exchange the app loads a single-use ticket URL in its own window, which is how the session cookie ends up in the app and not in the browser.

## Updates

Installed builds check [GitHub Releases](https://github.com/keplarone/keplar-desktop/releases) for a newer version and can download it in the background. There is no menu item for it. You can restart when a download finishes, or quit later and let it install then. The app id stays `one.keplar.desktop`, so an install of an earlier build can still take this update. The files it downloads use the `Keplar-One-` names in `latest.yml`, `latest-mac.yml`, and `latest-linux.yml`.

macOS will install that update only when the app is signed. Windows and the Linux AppImage can update without a certificate. Windows SmartScreen may warn again on the new installer.

## Build from source

You need Node.js 22 or newer.

```bash
git clone https://github.com/keplarone/keplar-desktop.git
cd keplar-desktop
npm ci
npm test
npm start
```

`npm start` typechecks, compiles, and opens the app against `https://keplar.one/app`.

Package the app for the operating system you are on:

```bash
npm run dist
```

Installers are written to `release/`. A full matrix (Windows NSIS, macOS dmg and zip for x64 and arm64, Linux AppImage, deb, and rpm) is built by the release workflow, not by one machine.

Regenerate icons from `assets/icon.svg` with `npm run icons`. The svg is the Keplar mark with a transparent background: a black rounded square, a black rounded right triangle, and a black circle. The packaged PNG, ICO, and ICNS put that black mark on a light rounded tile with a transparent surround and no outline or glow. A bare black mark disappears on a dark taskbar or dock, and the tile keeps it visible on dark and light ones alike. `npm run icons -- --transparent` writes the bare black mark with no tile instead.

## Cut a release

1. Bump `version` in `package.json` and keep `package-lock.json` in sync (`npm install` will do that).
2. Commit and push to `main`.
3. Tag that commit with the same version and push the tag:

```bash
git tag v0.1.5
git push origin v0.1.5
```

4. The **Release** workflow runs on `windows-latest`, `macos-latest`, and `ubuntu-latest`, builds the installers, writes `SHA256SUMS`, and publishes a GitHub Release for that tag with generated notes. It also uploads `latest.yml`, `latest-mac.yml`, and `latest-linux.yml`, which `electron-updater` reads.

You can run the same workflow by hand from the Actions tab. The tag you enter has to match `package.json` (`v` plus the version).

The workflow asks for `contents: write`. If publishing fails with a permissions error, open **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**.

### Code signing

Signing is optional. With none of the secrets below set, the workflow builds unsigned artifacts and still passes.

| Secret | Use |
| --- | --- |
| `CSC_LINK` | Base64 `.p12` / `.pfx` certificate. Used for macOS, and for Windows if `WIN_CSC_LINK` is not set. |
| `CSC_KEY_PASSWORD` | Password for `CSC_LINK`. |
| `WIN_CSC_LINK` | Windows certificate, if it should differ from `CSC_LINK`. |
| `WIN_CSC_KEY_PASSWORD` | Password for `WIN_CSC_LINK`. |
| `APPLE_ID` | Apple ID for notarization. Used only when `CSC_LINK` is also set. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | Apple Developer team id. |

Notarization needs the Apple secrets and a Developer ID certificate in `CSC_LINK`. An Apple ID without a certificate is ignored, so the macOS build stays unsigned instead of failing notarization.

## What the app allows

The window has no File, Edit, View, Window, or Help bar. On Windows and Linux the application menu is removed. On macOS the system menu bar keeps About, Hide, Quit, and Edit so Command-C, Command-V, and Command-Q keep working. Reload is Ctrl+R or F5 (Command-R on macOS). Zoom is Ctrl or Command with plus, minus, or 0. Full screen is F11, or Control-Command-F on macOS, and Escape leaves it. The page then fills the screen, including over the Windows taskbar. Developer tools stay off in an installed build. The window remembers its size, whether it was maximized, and whether it was full screen.

The user agent includes the token `keplar-desktop`. The document element is `html.keplar-desktop` with `data-keplar-desktop`. While the window is not full screen, `env(titlebar-area-x)`, `env(titlebar-area-y)`, `env(titlebar-area-width)`, and `env(titlebar-area-height)` describe the band beside the window controls. keplar.one can pad its nav with those values and mark non-interactive header space with `data-keplar-drag`. Links and buttons in that band stay clickable.

The main window loads `https://keplar.one` only, including subdomains, and only over HTTPS. `keplar://` links open the matching path on that site (`keplar://app/chat` opens `https://keplar.one/app/chat`). The window title stays Keplar One, including when the site says Ask Keplar.

Google, Microsoft, and Whop sign-in and checkout open in a separate window limited to those providers, then return to Keplar. Other links open in your default browser. Permission prompts are denied except the microphone (voice input) and notifications, and only when the request comes from `keplar.one`. There is no Node.js in the page, no preload API, and no webview.

A second launch focuses the window that is already open.

The source of this client is public so you can build it. It is not released under an open-source license (`UNLICENSED` in `package.json`).
