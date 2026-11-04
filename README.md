# Folder Gallery

A standalone, read-only image and WebM gallery. Copy **gallery.js** into any folder of
images and videos and run it. The interface, styles and server are all inside that one file;
no npm packages, installation scripts or generated gallery files are needed.
Requires Node.js 18 or newer (Node.js 22+ recommended). Works on Linux, Windows
and macOS with Node installed.

New to running scripts? Follow the [step-by-step setup guide](docs/QUICKSTART.md).

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
  landscape.jpg        → Main folder
  Holidays/
    beach.jpg          → Holidays
    Winter/
      snow.png         → Winter (path: Holidays/Winter)
  Family/
    birthday.webp      → Family
```

Each folder with directly contained images becomes a gallery. Nested folders
get separate galleries; their images are not duplicated in the parent gallery.
Empty folders and folders containing only other folders do not create empty
cards. Relative folder paths distinguish galleries with the same name.

Supported: JPG/JPEG, PNG, GIF, WebP, AVIF, BMP and WebM. Browser format and codec
support still applies. Hidden files/folders and symlinks are skipped. Files are
served without importing, renaming, deleting or uploading anything.

## Viewing

- Search by gallery name or relative folder path.
- Sort by name (A–Z or Z–A), modified date (newest or oldest), or size (largest
  or smallest). Sorting is applied before pagination and uses the active file-type
  filters. Gallery cards use the relative folder name, newest matching image's
  modification time, or total matching file size. Images use their own filename,
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
- 30 files per page, with numbered navigation at the top and bottom.
- Full-screen viewing, Previous/Next and Left/Right arrow keys across pages.
- Zoom buttons, mouse wheel, double-click zoom and drag to pan when zoomed.
- Escape closes the image, then the gallery; floating arrows return to the top.
- **Refresh folders** rescans after adding, moving or removing images. The index
  is kept in memory, with no repeated background scans or files written to disk.

Images are served directly from their existing locations. Pagination limits
image requests and API responses to the selected page; full-size originals are
used for the previews, with browser lazy loading. This first version does not
create smaller thumbnails, so very large originals can still take time to load.
It binds to loopback by default. Network access is opt-in (see below).

## WebM playback

WebM is included by default and has its own **WEBM** filter. Video-only folders
also become galleries. Grid and cover previews use static play-badge tiles;
there are no background video players or video downloads for those tiles.

Selecting a clip opens one player with native controls. It starts paused and
muted; press Play to begin and use the volume control to unmute. Moving to another
item, changing filters/sorting, or closing the viewer stops playback and releases
the source. Zoom controls apply to images only. Keyboard arrows navigate files;
when the video player itself has focus they retain the browser's native seeking
behaviour. Seeking uses HTTP byte-range responses.

The Info panel includes video dimensions and duration once metadata loads. An
original-WebM download link is available if the browser cannot decode the clip.
No FFmpeg or other dependencies are required; this version does not extract
thumbnail frames or transcode videos.

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
node gallery.js [folder] [--port 4180] [--host 127.0.0.1]
```

| Option | Default | Purpose |
| --- | --- | --- |
| `folder` | Folder containing `gallery.js` | Media folder to browse; quote paths containing spaces |
| `--port` | `4180` | TCP port; use another if the default is busy |
| `--host` | `127.0.0.1` | Local-only; use `0.0.0.0` or a local IPv4 address for network access |
| `--help` | — | Print usage instructions |

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `node` is not recognised | Install Node.js and reopen your terminal |
| No media appears | Check the selected folder and active type filters, then choose Refresh folders; hidden folders and symlinks are skipped |
| Port already in use | Start with `--port 4181`, then use the printed address |
| Another device cannot connect | Use `--host 0.0.0.0`, the correct Network URL, the same network and a local firewall rule allowing the port |
| WebM will not play | Your browser may not support the clip's codec; use Download original WebM |
| Large pictures load slowly | Previews use full-size originals; pagination and lazy loading limit requests but do not resize images |
| Changes are not visible | Choose Refresh folders for media changes; restart the script and refresh the browser after a script update |

## Validation

```bash
node --check gallery.js
node --test gallery.test.js
```

Automated checks cover folder discovery, nested-folder separation, sorting,
30-item API pages, all six sort orders, filtered pagination, unusual filenames, rescan behaviour, caching, read-only HTTP
methods, path/symlink access boundaries, WebM byte ranges, and optional network access. Browser controls are also exercised
against a small simulated DOM, including sorting, information panels and video teardown; real browser appearance and image/video decoding still
need a visual check.


The GitHub Actions workflow runs syntax checks and tests on Node.js 18, 22 and 24
on Ubuntu. It does not install any npm packages. On a local checkout you can also
run `npm run check` and `npm test`.

## Contributing

Keep the distributable `gallery.js` self-contained and dependency-free. Changes
to scanning, serving, filtering or controls should include relevant tests. Use
synthetic fixtures rather than personal media, and run the validation commands
before proposing a change. Describe the behaviour changed and any browser checks
performed.

## Licence

[MIT](LICENSE). See [CHANGELOG.md](CHANGELOG.md) for release notes.
