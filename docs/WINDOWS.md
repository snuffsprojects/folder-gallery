# Folder Gallery on Windows 11

The basic gallery requires only Node.js and `gallery.js`. Sharp image thumbnails
and FFmpeg video previews are independent optional upgrades.

## Install and start the basic gallery

1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/en/download).
   Keep the npm and PATH options enabled in the installer, then reopen your terminal.
2. Download the latest **gallery.js** from this repository using **Download raw file**.
   Save it as `gallery.js`, with no extra `.txt` extension.
3. Put it in your photo/video folder. In File Explorer, right-click an empty area
   of that folder and choose **Open in Terminal**.
4. Run:

   ```powershell
   node .\gallery.js
   ```

5. Open **http://127.0.0.1:4180** in your browser. Keep the terminal open;
   press **Ctrl+C** to stop the gallery.

If the script lives elsewhere, you can give it the media folder explicitly:

```powershell
node "C:\Tools\Folder Gallery\gallery.js" "D:\Photos"
```

## Browse your folders

Home shows immediate subfolders and directly contained media. Open a folder to
see its own subfolders and files; the hierarchy matches File Explorer, including
empty folders and folders containing only subfolders. Use **Back** to move up a
level, or breadcrumbs such as **Home → Holidays → Winter** to jump to an ancestor.

Search finds folders anywhere in the collection and shows their relative paths.
Opening a result clears search and takes you to that folder. Folder-card counts
and sizes include their whole branch; the media grid shows only directly
contained files, with 30 files per page. Filters retain the folder structure even
when no files match.

## Optional: faster image previews with Sharp

Stop the gallery, open a terminal in the folder containing `gallery.js`, and run:

```powershell
npm.cmd install --no-save --package-lock=false sharp
```

`npm.cmd` also works when PowerShell blocks the `npm.ps1` script, so no execution
policy changes are necessary. This installs Sharp into `node_modules` beside
`gallery.js`. Keep that folder there; moving the script alone requires installing
Sharp again at its new location. Sharp normally downloads the required binaries
for supported Windows systems; a separate image editor is not needed.

Start the gallery normally. Look for **Thumbnail acceleration enabled (Sharp images)**.
Full-screen viewing still uses your full-quality original files.

## Optional: WebM still-frame previews with FFmpeg

Sharp is not needed for this option. FFmpeg is installed separately and can be
used by every copy of the gallery on the computer.

In PowerShell or Windows Terminal, run:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Accept any installation prompts. This uses the x64 FFmpeg build in the
[Microsoft WinGet package catalog](https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Gyan/FFmpeg).
If WinGet is unavailable, install/update **App Installer** from Microsoft Store,
then try again, or use the manual method below.

**Close and reopen your terminal** after installation. Check:

```powershell
ffmpeg -version
```

If a version is printed, open a terminal in the folder containing the latest
`gallery.js` and start normally:

```powershell
node .\gallery.js
```

Look for **WebM previews enabled (FFmpeg)**. Video cards will show a still frame
with a play badge. The first visit generates previews; later visits reuse them.
Opening a clip still uses its original WebM file and normal player controls.

### Manual FFmpeg installation

1. Visit [FFmpeg's download page](https://ffmpeg.org/download.html#build-windows)
   and choose a linked Windows build appropriate for your computer. Use a build
   with WebM decoding and `libwebp` encoding support; common full builds include both.
2. Extract it to a permanent folder, such as `C:\Tools\ffmpeg`.
3. Find the folder containing **ffmpeg.exe**, typically `C:\Tools\ffmpeg\bin`.
4. Search Start for **Edit environment variables for your account**. Edit your
   user **Path**, choose **New**, and add that folder. Confirm with **OK**.
5. Close and reopen the terminal. Run `ffmpeg -version`, then restart the gallery.

The gallery searches PATH; it does not require FFmpeg beside `gallery.js` or
anything installed through npm for video previews. Keep the extracted FFmpeg
folder at the location added to PATH.

## Cache and disable options

Both upgrades use the same **512 MiB** cache, normally at:

```text
%LOCALAPPDATA%\folder-gallery\thumbnails-v1
```

The startup message prints its actual location. Old previews are removed as space
is needed; changed originals automatically get new previews. Original files are
never changed. You can delete this cache with the gallery stopped to free space.

Disable video previews while keeping Sharp image thumbnails:

```powershell
node .\gallery.js --no-video-thumbnails
```

Disable both optional processors and all thumbnail cache access:

```powershell
node .\gallery.js --no-thumbnails
```

If either tool is missing or fails, the gallery continues to work: images use
their originals and videos use the existing play-badge tile. FFmpeg extraction
does not change which video codecs your browser can play.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `node` or `npm.cmd` not recognised | Reopen the terminal after installing Node.js; check that the Node.js installer added it to PATH |
| `ffmpeg` not recognised | Reopen the terminal after installation; for manual installs, add the folder containing `ffmpeg.exe` to user Path |
| FFmpeg prints a version but the gallery says it is unavailable | Stop and restart the gallery from that same terminal; ensure you downloaded the latest `gallery.js` |
| Sharp is installed but image thumbnails are off | Use Node.js 22+ and install Sharp in the folder containing the script; restart it |
| Videos still show a badge | Remove preview-disable flags, check FFmpeg supports the clip and `libwebp`, and try another clip; broken/unsupported clips retain badge tiles |
| A video preview appears but playback fails | Your browser may not support the original codec; try another browser or Download original WebM |

For access from another device, see the [quick-start network instructions](QUICKSTART.md#5-view-from-another-device-optional).
