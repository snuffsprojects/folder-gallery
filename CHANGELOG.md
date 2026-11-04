# Changelog

## Unreleased

- Optional FFmpeg support for cached WebM still-frame previews with a play badge, independent of Sharp.
- Automatic FFmpeg detection, first-frame fallback for short clips, bounded processing and badge fallback on failures.
- Shared image/video cache and `--no-video-thumbnails` to disable only video extraction.
- Windows 11 setup guide, updated CLI help and documentation, plus FFmpeg integration tests and CI jobs.
- Optional Sharp image processing, detected automatically when installed beside the script.
- On-demand WebP thumbnails for covers and grids, with original-quality full-screen images.
- A 512 MiB user cache with automatic eviction and invalidation when originals change.
- Two simultaneous image processors, bounded request backlog and fallback to originals.
- `--no-thumbnails` to retain basic mode without cache access.
- Installation instructions and tests with and without Sharp, including orientation and transparency.

## 0.1.0 — 2026-11-04

Initial release:

- Standalone, dependency-free gallery in a single JavaScript file.
- Separate galleries for folders and nested folders, plus root-folder media.
- Folder search, file-type filters, six sort orders and 30-item pagination.
- Full-screen images with zoom, panning and keyboard navigation.
- File information with dimensions, size and modified date.
- WebM playback with static tiles, byte-range seeking and playback cleanup.
- Optional local-network access with local-only access by default.
- Automated tests, GitHub Actions workflow and MIT licence.
