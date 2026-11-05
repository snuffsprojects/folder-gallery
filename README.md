# Folder Gallery

A standalone, read-only image and WebM gallery. Copy **gallery.js** into any folder of
images and videos and run it. The interface, styles and server are all inside that one file;
no npm packages, installation scripts or generated gallery files are needed.
Optional Sharp speeds up image previews; optional FFmpeg adds still-frame WebM previews.
Requires Node.js 18 or newer (Node.js 22+ recommended). Works on Linux, Windows
and macOS with Node installed.

New to running scripts? Follow the [step-by-step setup guide](docs/QUICKSTART.md).
For Windows 11, see the [Windows installation guide](docs/WINDOWS.md), including both optional upgrades.

## Get the script

Open **gallery.js** in this repository and choose **Download raw file**, or use
**Code → Download ZIP** and extract the download. You only need `gallery.js` to
run the gallery. Keep it named `gallery.js`, with no extra `.txt` extension.
There is no build step or `npm install` command.

## Start

From a terminal in the folder containing the script:

```bash
node gallery.js
```

Open **http://127.0.0.1:4180** in a browser on the same computer. Stop with Ctrl+C.
The default image root is the folder containing the script, even when you run it
from a different working directory.

You can also keep the script elsewhere and supply the folder to browse:

```bash
node gallery.js "/path/to/photos"
node gallery.js "/path/to/photos" --port 4181
```

In Windows PowerShell, for example:

```powershell
node .\gallery.js "D:\Photos"
```

## How folders become galleries

```text
Photos/
  gallery.js
  landscape.jpg        → Files on Home
  Holidays/
    beach.jpg          → Files inside Holidays
    Winter/
      snow.png         → Home → Holidays → Winter
  Family/
    birthday.webp      → Home → Family
```

The gallery preserves the real folder hierarchy. **Home** shows the immediate
subfolders of your selected root, plus directly contained media under **Files in
this folder**. Open a folder to see its immediate subfolders and its own media;
nested files are never mixed into the parent's image grid.

When a folder contains both subfolders and media, use the sticky header's
**Files in this folder (N) ↓** button to jump straight to its own images and videos
below the subfolder cards. **Subfolders (N) ↓** returns to the folder list. The
media section has its own heading and direct-file count; Home also has a shortcut
to its directly contained media. These counts respect the active file-type filters.

Folders containing only subfolders, and completely empty folders, remain visible.
Folder cards show matching file counts and sizes for their whole branch and can
use a descendant image as a cover. The actual media grid and its pagination only
include files directly in the open folder.

Use **Back** to move up one level, or click a breadcrumb such as
**Home → Holidays → Winter** to jump to an ancestor. The **Home** breadcrumb returns
to the root. Search finds folders anywhere in the collection and shows their full
relative paths, so identically named folders in different branches remain distinct.
Opening a search result clears the search and takes you straight to that folder;
its breadcrumbs and Back button follow the real folder hierarchy.

Supported: JPG/JPEG, PNG, GIF, WebP, AVIF, BMP and WebM. Browser format and codec
support still applies. Hidden files/folders, symlinks and `node_modules` folders are skipped. Files are
served without importing, renaming, deleting or uploading anything.

## Viewing

- Search all folders by name or relative path. Clear the search to return to the
  top-level folder list. Root-level media is hidden while search results are shown.
- Sort by name (A–Z or Z–A), modified date (newest or oldest), or size (largest
  or smallest). Sorting is applied before pagination and uses the active file-type
  filters. Folder cards use the folder name, newest matching media's modification
  time anywhere in the branch, or total matching file size in that branch. Images use their own filename,
  modified date, or file size. Sorting controls on both pages stay synchronized;
  changing the order returns to page 1 without rescanning the folders.
- In the full-screen viewer, choose **Info** (or press **I**) to see filename,
  folder, format, decoded pixel dimensions, exact file size, and modified date.
  The panel updates as you browse; dimensions appear after the image loads.
  Modified dates come from the filesystem, not camera/EXIF capture dates.
- File-type checkboxes on the collection page and inside galleries. All formats
  start enabled; turn off any you want to hide, or choose **Clear** and select
  just one type. **All types** restores every format. JPG and JPEG are grouped.
  Filters apply to gallery covers, counts, storage totals, pagination and
  full-screen navigation. Changing types returns to page 1 and uses the in-memory
  index without rescanning folders. The two filter bars stay synchronized.
  Folder structure stays visible even when no files match the selected types.
- 30 directly contained files per page, with numbered navigation at the top and
  bottom, including for files shown on Home.
- Full-screen viewing, Previous/Next and Left/Right arrow keys across pages.
- Zoom buttons, mouse wheel, double-click zoom and drag to pan when zoomed.
- Escape closes the image, then returns from a folder to Home; **Back** moves up
  one folder level. Floating arrows return to the top.
- **Refresh folders** rescans after adding, moving or removing images. The index
  is kept in memory, with no repeated background scans or index files written to disk.
  Only optional thumbnail generation writes cache files in your user cache folder.

Images are served directly from their existing locations. Pagination limits
image requests and API responses to the selected page, with browser lazy loading.
By default previews use full-size originals, so very large originals can take time
to load. Optional thumbnail acceleration reduces preview downloads (see below).
It binds to loopback by default. Network access is opt-in (see below).

## Faster previews (optional)

The script works without installing anything. For large pictures or browsing over
Wi-Fi, you can optionally install [Sharp](https://sharp.pixelplumbing.com/install/).
Use **Node.js 22 or newer** for this option; Node.js 18 still works in the basic mode.
Open a terminal in the folder containing **gallery.js** and run once:

```bash
npm install --no-save --package-lock=false sharp
```

Then start normally:

```bash
node gallery.js
```

The terminal prints **Thumbnail acceleration enabled** when Sharp loads. Most
Node.js installers include npm; if `npm` is not recognised, install it using your
Node.js installer or your Linux distribution's package manager. Sharp normally
downloads ready-built binaries for supported systems; no separate image tool is
needed. Installation requires internet access; everyday use works offline.

- Album covers and image grids use WebP thumbnails up to **640 × 640 pixels**,
  preserving aspect ratio, orientation and transparency without enlarging small images.
- Thumbnails are created only as requested, with at most two images processed at
  once. The first visit may be slower while they are generated; later visits reuse them.
- Full-screen viewing, zooming and file information use the original images.
- Animated images use a still frame for their thumbnails. Animation remains
  available when opening the original. WebM frames use optional FFmpeg instead (see below).
- Unsupported images (including BMP on typical Sharp builds), images over
  40 megapixels, processing errors and cache failures fall back to the original.
- Sharp is detected automatically at startup. If it is absent or cannot load,
  the gallery works in basic mode. Nothing is installed automatically.

The thumbnail cache is separate from your photo folders, shared by galleries run
under your user account, and limited to **512 MiB**. Older thumbnails are removed
as space is needed. Changed originals get new thumbnails automatically, without
waiting for a folder rescan. Use **Refresh folders** to update the grid's file list
and file information. You can delete the cache while the gallery is stopped; it
will be rebuilt as needed. Cached previews remain until evicted or deleted, even
if you remove their originals.

| System | Default cache location |
| --- | --- |
| Linux | `~/.cache/folder-gallery/thumbnails-v1` (or inside `$XDG_CACHE_HOME` when set to an absolute path) |
| macOS | `~/Library/Caches/folder-gallery/thumbnails-v1` |
| Windows | `%LOCALAPPDATA%\folder-gallery\thumbnails-v1` |

The terminal prints the cache location. Original media files are never modified.
To disable acceleration, including all thumbnail cache access:

```bash
node gallery.js --no-thumbnails
```

Sharp is installed in `node_modules` beside the script. Keep that folder beside
`gallery.js`, or install Sharp again if you move the script. Alternatively, keep
one installed copy of the script and pass any photo folder as its argument:

```bash
node "/path/to/gallery.js" "/path/to/photos"
```

## WebM previews (optional)

Install [FFmpeg](https://ffmpeg.org/download.html) to replace WebM badge tiles with
still-frame previews. **Sharp is not required for video previews.** Both upgrades
are independent, and the gallery still works with neither installed.

On **Windows 11**, open PowerShell or Windows Terminal and run:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Close and reopen your terminal after installation, then check:

```powershell
ffmpeg -version
```

Start the latest `gallery.js` normally. The terminal should show
**WebM previews enabled (FFmpeg)**. See the [Windows guide](docs/WINDOWS.md) for
manual installation and troubleshooting. The WinGet package is an x64 build.

On **Ubuntu/Debian**, install with `sudo apt update` followed by
`sudo apt install ffmpeg`. On **macOS**, if you use Homebrew, run
`brew install ffmpeg`. Alternatively, use a build linked from the FFmpeg download
page. The executable must be available as `ffmpeg` on your system's `PATH`.

- Album covers and video tiles show a still frame with a play badge; no background
  video players are created and the browser only downloads the preview image.
- FFmpeg extracts a frame around one second into the clip, falling back to the
  first frame for very short clips. It produces a WebP image up to 640 × 640 pixels.
- Video and image previews share the 512 MiB user cache and the limit of two
  processing jobs at once. Changed clips automatically get new previews.
- Missing FFmpeg, unsupported codecs, broken clips, processing timeouts or cache
  errors leave the normal play-badge tile. Video playback still works as before.
- FFmpeg is detected at startup; restart the script after installing it. The
  build needs WebM decoding and the `libwebp` encoder, as included in common full builds.
- The original videos are never modified or transcoded for playback. Creating a
  still frame does not add browser support for an unsupported video codec.

Disable just video previews while keeping Sharp image thumbnails:

```bash
node gallery.js --no-video-thumbnails
```

Use `--no-thumbnails` to disable both optional processors and all cache access.

## WebM playback

WebM is included by default and has its own **WEBM** filter. Video-only folders
also become galleries. Grid and cover previews use cached still frames when
FFmpeg is available, or static play-badge tiles otherwise. There are no background
video players or original-video downloads for those tiles.

Selecting a clip opens one player with native controls. It starts paused and
muted; press Play to begin and use the volume control to unmute. Moving to another
item, changing filters/sorting, or closing the viewer stops playback and releases
the source. Zoom controls apply to images only. Keyboard arrows navigate files;
when the video player itself has focus they retain the browser's native seeking
behaviour. Seeking uses HTTP byte-range responses.

The Info panel includes video dimensions and duration once metadata loads. An
original-WebM download link is available if the browser cannot decode the clip.
Playback needs no FFmpeg or other dependencies. Only the optional still-frame
previews use FFmpeg; playback always serves the existing WebM file.

## Access from another computer

Start the script on the computer holding the files with:

```bash
node gallery.js --host 0.0.0.0
```

Or supply a folder and a different port:

```bash
node gallery.js "/path/to/photos" --host 0.0.0.0 --port 4180
```

The terminal prints **Network:** URLs such as `http://192.168.1.50:4180`.
Open that URL on another computer or phone on the same network. Use the address
of the computer running the script, not `0.0.0.0` or `127.0.0.1`. The script must
remain running, and the host computer's firewall must allow the chosen TCP port
from the local network (on Windows, allow Node.js on the Private network).
Guest Wi-Fi or client isolation can prevent devices from reaching each other.

You can bind only one network interface by passing its IPv4 address, for example
`--host 192.168.1.50`. Without `--host`, access stays on the same computer.
There is no login: network mode is for a trusted home network. Do not forward
its port to the internet. This script does not change firewall or router settings.
If a network interface/IP changes while running, restart the script.

## Command-line options

```text
node gallery.js [folder] [--port 4180] [--host 127.0.0.1] [--no-thumbnails] [--no-video-thumbnails]
```

| Option | Default | Purpose |
| --- | --- | --- |
| `folder` | Folder containing `gallery.js` | Media folder to browse; quote paths containing spaces |
| `--port` | `4180` | TCP port; use another if the default is busy |
| `--host` | `127.0.0.1` | Local-only; use `0.0.0.0` or a local IPv4 address for network access |
| `--no-thumbnails` | Auto-detect Sharp and FFmpeg | Disable all thumbnail processing and cache access |
| `--no-video-thumbnails` | Auto-detect FFmpeg | Disable video previews while allowing image thumbnails |
| `--help` | — | Print usage instructions |

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `node` is not recognised | Install Node.js and reopen your terminal |
| No media appears | Check the selected folder and active type filters, then choose Refresh folders; hidden folders and symlinks are skipped |
| Port already in use | Start with `--port 4181`, then use the printed address |
| Another device cannot connect | Use `--host 0.0.0.0`, the correct Network URL, the same network and a local firewall rule allowing the port |
| WebM will not play | Your browser may not support the clip's codec; use Download original WebM |
| Large pictures load slowly | Install optional Sharp for smaller previews; full-screen viewing still loads the original |
| Sharp is installed but thumbnails are off | Restart the script, use Node.js 22+, and install Sharp in the folder containing `gallery.js` |
| FFmpeg is installed but WebM previews are off | Reopen the terminal, check `ffmpeg -version`, then restart the script; remove `--no-thumbnails` or `--no-video-thumbnails` if present |
| A video still shows a play-badge tile | Extraction may have failed; use an FFmpeg build with WebM decoding and `libwebp`, and check the clip is readable; playback remains available |
| Changes are not visible | Choose Refresh folders for media changes; restart the script and refresh the browser after a script update |

## Validation

```bash
node --check gallery.js
node --test gallery.test.js thumbnail.test.js video.test.js hierarchy.test.js browser.test.js
```

Automated checks cover folder discovery, nested-folder separation, sorting,
30-item API pages, all six sort orders, filtered pagination, unusual filenames, rescan behaviour, caching, read-only HTTP
methods, path/symlink access boundaries, WebM byte ranges, and optional network access. Browser controls are also exercised
against a small simulated DOM, including sorting, information panels and video teardown; real browser appearance and image/video decoding still
need a visual check.


The GitHub Actions workflow runs syntax checks and tests without dependencies on
Node.js 18, 22 and 24, plus actual Sharp and FFmpeg conversion tests on Node.js 22
and 24, including an FFmpeg-only job without Sharp.
Thumbnail tests cover cache reuse, invalidation, eviction, processing limits,
fallbacks, HTTP caching and access boundaries. On a local checkout you can also
run `npm run check` and `npm test`. To include actual image conversion after
installing Sharp, set `FOLDER_GALLERY_TEST_SHARP=1` when running the tests (on
Linux/macOS: `FOLDER_GALLERY_TEST_SHARP=1 npm test`; PowerShell:
`$env:FOLDER_GALLERY_TEST_SHARP='1'; npm test`).
Set `FOLDER_GALLERY_TEST_FFMPEG=1` to include real video extraction tests with
`ffmpeg` and `ffprobe` installed. Set both variables to test both upgrades together.
Video tests cover short clips, unusual filenames, cached WebP output, invalidation,
unavailable/disabled processing, access boundaries and unchanged byte-range playback.
Hierarchy tests cover immediate-child navigation, folders with no direct media,
empty folders, root media pagination and viewing, recursive totals, filters,
duplicate names, special paths, breadcrumbs, parent navigation, search, rescans
and responses arriving after the user has navigated elsewhere.

A separate CI job checks mixed-folder layouts in real Chromium at desktop and
mobile sizes, including jumping to direct media, pagination and parent navigation.
To run it locally with Node.js 22+, install the test tools and browser:

```bash
npm install --no-save --package-lock=false playwright sharp
npx playwright install chromium
```

Then run `FOLDER_GALLERY_TEST_BROWSER=1 node --test browser.test.js` on Linux/macOS,
or `$env:FOLDER_GALLERY_TEST_BROWSER='1'; node --test browser.test.js` in PowerShell.
These tools are only for development tests; the distributed script still needs
no dependencies for basic use.

## Contributing

Keep the distributable `gallery.js` self-contained and functional without dependencies. Changes
to scanning, serving, filtering or controls should include relevant tests. Use
synthetic fixtures rather than personal media, and run the validation commands
before proposing a change. Describe the behaviour changed and any browser checks
performed.

## Licence

[MIT](LICENSE). See [CHANGELOG.md](CHANGELOG.md) for release notes.
