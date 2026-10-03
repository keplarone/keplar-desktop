# Keplar for desktop

Keplar is a window onto [keplar.one](https://keplar.one).

One question. Multiple intelligences. One answer.

Sign-in, questions, and answers stay on Keplar's servers. This app does not keep its own copy of them. It does keep a normal browser session for `keplar.one` (cookies and site storage, so you can stay signed in), the window size, Chromium's cache, and any file you explicitly save. Those live in the app's user-data folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Keplar` |
| macOS | `~/Library/Application Support/Keplar` |
| Linux | `~/.config/Keplar` |

If that folder is not there, look for `keplar-desktop` next to it. Removing it signs you out on this computer. Uninstalling the app does not always remove it.

## Install

Download a release from [GitHub Releases](https://github.com/keplarone/keplar-desktop/releases). The first builds are unsigned unless a code-signing certificate has been added to the repository secrets. Unsigned apps are safe to run only if you trust this repository. The operating system will warn you, and that warning is expected.

Each release includes `SHA256SUMS`. Check a download with `sha256sum -c SHA256SUMS` (or `Get-FileHash` on Windows) before you open it.

### Windows

File: `Keplar-<version>-win-x64.exe`

The installer is an NSIS setup wizard for 64-bit Windows. It is a per-user install unless you change that in the wizard.

SmartScreen will say it prevented an unrecognized app from starting. Choose **More info**, then **Run anyway**.

### macOS

Files:

- `Keplar-<version>-mac-arm64.dmg` for Apple silicon
- `Keplar-<version>-mac-x64.dmg` for Intel Macs

The `.zip` files next to them are what auto-update uses. Install from the `.dmg`: open it and drag Keplar to Applications.

Gatekeeper will say the app cannot be opened because the developer cannot be verified, or that it is damaged. Either of these works:

- Right-click `Keplar.app`, choose **Open**, then **Open** again.
- Or, in Terminal: `xattr -cr /Applications/Keplar.app` and open the app again.

macOS auto-update only works after the app is code-signed and notarized. An unsigned copy will not replace itself. Download the next `.dmg` instead. See [Updates](#updates).

### Linux

Files, all x64:

- `Keplar-<version>-linux-x86_64.AppImage`
- `Keplar-<version>-linux-amd64.deb`
- `Keplar-<version>-linux-x86_64.rpm`

`x86_64` and `amd64` are the same CPU. The names follow the usual names for AppImage, deb, and rpm.

AppImage:

```bash
chmod +x Keplar-*-linux-x86_64.AppImage
./Keplar-*-linux-x86_64.AppImage
```

Debian or Ubuntu: `sudo apt install ./Keplar-*-linux-amd64.deb`

Fedora or RHEL: `sudo rpm -i Keplar-*-linux-x86_64.rpm` (or `sudo dnf install ./Keplar-*-linux-x86_64.rpm`)

Auto-update applies to the AppImage. deb and rpm installs are updated by installing the next package.

## Updates

Installed builds check [GitHub Releases](https://github.com/keplarone/keplar-desktop/releases) for a newer version and can download it in the background. **Help → Check for Updates…** checks immediately. You can restart when a download finishes, or quit later and let it install then.

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

Regenerate icons from `assets/icon.svg` with `npm run icons`. The svg is the Keplar mark on white: a black rounded square, a black rounded right triangle, and a black circle.

## Cut a release

1. Bump `version` in `package.json` and keep `package-lock.json` in sync (`npm install` will do that).
2. Commit and push to `main`.
3. Tag that commit with the same version and push the tag:

```bash
git tag v0.1.1
git push origin v0.1.1
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

The main window loads `https://keplar.one` only, including subdomains, and only over HTTPS. `keplar://` links open the matching path on that site (`keplar://app/chat` opens `https://keplar.one/app/chat`).

Google, Microsoft, and Whop sign-in and checkout open in a separate window limited to those providers, then return to Keplar. Other links open in your default browser. Permission prompts are denied except the microphone (voice input) and notifications, and only when the request comes from `keplar.one`. There is no Node.js in the page, no preload API, and no webview.

A second launch focuses the window that is already open.

The source of this client is public so you can build it. It is not released under an open-source license (`UNLICENSED` in `package.json`).
