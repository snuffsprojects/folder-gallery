#!/usr/bin/env node
'use strict';
// Folder Gallery — copy this file into an image folder and run: node gallery.js
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const localAddresses = () => Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address);
const PAGE_SIZE = 30;
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.webm': 'video/webm' };
const FORMATS = ['jpg', 'png', 'gif', 'webp', 'avif', 'bmp', 'webm'];
const SORTS = ['name-asc', 'name-desc', 'date-desc', 'date-asc', 'size-desc', 'size-asc'];
function compareItems(a, b, sort, nameKey = 'name') {
  const names = natural.compare(a[nameKey], b[nameKey]);
  if (sort === 'name-desc') return -names;
  if (sort === 'date-desc') return b.modifiedMs - a.modifiedMs || names;
  if (sort === 'date-asc') return a.modifiedMs - b.modifiedMs || names;
  if (sort === 'size-desc') return b.bytes - a.bytes || names;
  if (sort === 'size-asc') return a.bytes - b.bytes || names;
  return names;
}
const imageType = name => path.extname(name).slice(1).toLowerCase().replace(/^jpeg$/, 'jpg');
function selectedFormats(url) {
  if (!url.searchParams.has('types')) return null;
  return new Set(url.searchParams.get('types').split(',').filter(Boolean).map(type => type.toLowerCase().replace(/^jpeg$/, 'jpg')));
}
function filterAlbum(album, formats, sort = 'name-asc') {
  const images = album.images.filter(item => !formats || formats.has(imageType(item.name))).sort((a, b) => compareItems(a, b, sort));
  return { ...album, images, modifiedMs: images.reduce((latest, item) => Math.max(latest, item.modifiedMs), 0), count: images.length, bytes: images.reduce((sum, item) => sum + item.bytes, 0), cover: images[0]?.url || null, coverType: images[0]?.type || 'image' };
}
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const mediaUrl = relative => '/media/' + relative.split(path.sep).map(encodeURIComponent).join('/');

async function scanFolders(root) {
  const albums = new Map();
  const warnings = [];
  async function visit(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (error) { warnings.push(`Could not read ${path.relative(root, dir) || 'Main folder'} (${error.code}).`); return; }
    entries.sort((a, b) => natural.compare(a.name, b.name));
    const images = [];
    for (const entry of entries) {
      // Do not follow symlinks, hidden folders, or hidden files.
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || (entry.isDirectory() && entry.name === 'node_modules')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && TYPES[path.extname(entry.name).toLowerCase()]) {
        try {
          const stat = await fsp.stat(full);
          images.push({ type: imageType(entry.name) === 'webm' ? 'video' : 'image', name: entry.name, url: mediaUrl(path.relative(root, full)), bytes: stat.size, modifiedMs: stat.mtimeMs, modifiedAt: stat.mtime.toISOString() });
        } catch (error) { warnings.push(`Could not read ${path.relative(root, full)} (${error.code}).`); }
      }
    }
    if (images.length) {
      const relative = path.relative(root, dir);
      const id = relative.split(path.sep).join('/') || '.';
      albums.set(id, { id, name: relative ? path.basename(dir) : 'Main folder', folder: relative.split(path.sep).join('/'), count: images.length, bytes: images.reduce((sum, item) => sum + item.bytes, 0), cover: images[0].url, coverType: images[0].type, images });
    }
  }
  await visit(root);
  return { albums, warnings };
}

function sendJson(req, res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  if (match.slice(1).some(value => value && !Number.isSafeInteger(Number(value)))) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end || (!match[1] && Number(match[2]) === 0)) return null;
  return { start, end };
}

function loadSharp() {
  try { return require('sharp'); } catch { return null; }
}

function thumbnailCacheDirectory() {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
      : process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME) ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache');
  return path.join(base, 'folder-gallery', 'thumbnails-v1');
}

// Only previews use Sharp. Cache/decoder errors are handled by the media route,
// which serves the original instead. No media files or folders are written to.
function createThumbnailCache(sharp, { cacheDir = thumbnailCacheDirectory(), maxBytes = 512 * 1024 * 1024 } = {}) {
  const pending = new Map(), waiting = [];
  let active = 0, entries, totalBytes = 0, cacheWork = Promise.resolve();
  function withCache(operation) {
    const result = cacheWork.then(operation);
    cacheWork = result.catch(() => {});
    return result;
  }
  async function trim() {
    if (totalBytes <= maxBytes) return;
    for (const [name, entry] of [...entries].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
      if (totalBytes <= maxBytes) break;
      await fsp.unlink(path.join(cacheDir, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      totalBytes -= entry.bytes; entries.delete(name);
    }
  }
  async function initialise() {
    if (entries) return;
    await fsp.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const found = new Map();
    let bytes = 0;
    for (const name of await fsp.readdir(cacheDir)) {
      if (!/^[a-f0-9]{64}\.webp$/.test(name)) continue;
      try {
        const stat = await fsp.lstat(path.join(cacheDir, name));
        if (stat.isFile()) { found.set(name, { bytes: stat.size, usedAt: stat.mtimeMs }); bytes += stat.size; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    entries = found; totalBytes = bytes;
    await trim();
  }
  async function withSlot(operation) {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await operation(); }
    finally { if (waiting.length) waiting.shift()(); else active--; }
  }
  return function thumbnail(file, stat) {
    const key = createHash('sha256').update(JSON.stringify([file, stat.size, stat.mtimeMs, stat.ctimeMs])).digest('hex');
    if (pending.has(key)) return pending.get(key);
    // Bound the backlog as well as the number of simultaneous decoders.
    if (pending.size >= 32) return Promise.reject(new Error('Thumbnail queue full.'));
    const name = key + '.webp', cached = path.join(cacheDir, name);
    const task = withSlot(async () => {
      const hit = await withCache(async () => {
        await initialise();
        if (!entries.has(name)) return null;
        try {
          const buffer = await fsp.readFile(cached);
          const now = new Date();
          await fsp.utimes(cached, now, now);
          entries.get(name).usedAt = now.getTime();
          return buffer;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          totalBytes -= entries.get(name).bytes; entries.delete(name);
          return null;
        }
      });
      if (hit) return { buffer: hit, etag: `"thumb-v1-${key}"` };
      const buffer = await sharp(file, { limitInputPixels: 40_000_000, animated: false })
        .rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
      await withCache(async () => {
        const temporary = path.join(cacheDir, '.' + randomUUID() + '.tmp');
        try {
          await fsp.writeFile(temporary, buffer, { mode: 0o600, flag: 'wx' });
          await fsp.rename(temporary, cached);
        } finally { await fsp.unlink(temporary).catch(() => {}); }
        totalBytes += buffer.length - (entries.get(name)?.bytes || 0);
        entries.set(name, { bytes: buffer.length, usedAt: Date.now() });
        await trim();
      });
      return { buffer, etag: `"thumb-v1-${key}"` };
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

async function createGallery(root, { host = '127.0.0.1', thumbnails = true, sharp = thumbnails ? loadSharp() : null, cacheDir, cacheBytes } = {}) {
  const networkMode = host !== '127.0.0.1';
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(networkMode ? localAddresses() : [])]);
  if (networkMode && host !== '0.0.0.0') allowedHosts.add(host);
  root = await fsp.realpath(root);
  if (!(await fsp.stat(root)).isDirectory()) throw new Error('The gallery root must be a folder.');
  const thumbnail = thumbnails && sharp ? createThumbnailCache(sharp, { cacheDir, maxBytes: cacheBytes }) : null;
  let index;
  let scanning;
  async function getIndex(refresh = false) {
    if (scanning) return scanning;
    if (index && !refresh) return index;
    scanning = scanFolders(root).then(result => (index = result)).finally(() => { scanning = null; });
    return scanning;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      // Validate the requested host and reject cross-site browser requests.
      const host = req.headers.host || '';
      if (!allowedHosts.has(new URL('http://' + host).hostname)) return sendJson(req, res, 403, { error: 'Gallery host not allowed.' });
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`)) return sendJson(req, res, 403, { error: 'Local access only.' });
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return sendJson(req, res, 405, { error: 'Read-only gallery.' }); }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : HTML);
      }
      const sort = url.searchParams.get('sort') || 'name-asc';
      if (url.pathname.startsWith('/api/') && !SORTS.includes(sort)) return sendJson(req, res, 400, { error: 'Invalid sort order.' });
      if (url.pathname === '/api/albums') {
        const data = await getIndex(url.searchParams.get('refresh') === '1');
        const formats = selectedFormats(url);
        const albums = [...data.albums.values()].map(album => filterAlbum(album, formats, sort)).filter(album => album.count);
        return sendJson(req, res, 200, { root: path.basename(root), thumbnails: Boolean(thumbnail), totalImages: [...data.albums.values()].reduce((sum, album) => sum + album.count, 0), albums: albums.sort((a, b) => compareItems(a, b, sort, 'folder')).map(({ images, ...album }) => album), warnings: data.warnings });
      }
      if (url.pathname === '/api/gallery') {
        const data = await getIndex();
        const original = data.albums.get(url.searchParams.get('id'));
        if (!original) return sendJson(req, res, 404, { error: 'Gallery not found. Try refreshing the folders.' });
        const album = filterAlbum(original, selectedFormats(url), sort);
        const page = Number(url.searchParams.get('page') || 1);
        const pages = Math.max(1, Math.ceil(album.count / PAGE_SIZE));
        if (!Number.isSafeInteger(page) || page < 1 || page > pages) return sendJson(req, res, 400, { error: 'Invalid page.' });
        const { images, ...summary } = album;
        return sendJson(req, res, 200, { ...summary, page, pages, pageSize: PAGE_SIZE, images: images.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) });
      }
      if (url.pathname.startsWith('/media/')) {
        let relative;
        try { relative = decodeURIComponent(url.pathname.slice(7)); } catch { return sendJson(req, res, 400, { error: 'Invalid filename.' }); }
        const candidate = path.resolve(root, relative);
        const inside = file => file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
        if (!inside(candidate) || !TYPES[path.extname(candidate).toLowerCase()] || relative.split(/[\\/]/).some(part => part.startsWith('.'))) return sendJson(req, res, 404, { error: 'Image not found.' });
        let file, stat;
        try {
          file = await fsp.realpath(candidate);
          if (!inside(file)) return sendJson(req, res, 404, { error: 'Image not found.' });
          stat = await fsp.stat(file);
          if (!stat.isFile()) throw new Error('Not a file');
        } catch { return sendJson(req, res, 404, { error: 'Image not found.' }); }
        if (thumbnail && url.searchParams.get('thumbnail') === '1' && !url.searchParams.has('download') && imageType(file) !== 'webm') {
          let preview;
          try { preview = await thumbnail(file, stat); } catch { /* Unsupported image or unavailable cache: serve the original. */ }
          if (preview) {
            const headers = { 'Content-Type': 'image/webp', 'Content-Length': preview.buffer.length, ETag: preview.etag, 'Cache-Control': 'private, max-age=0, must-revalidate' };
            if (req.headers['if-none-match'] === preview.etag) { res.writeHead(304, { ETag: preview.etag, 'Cache-Control': headers['Cache-Control'] }); return res.end(); }
            res.writeHead(200, headers);
            return res.end(req.method === 'HEAD' ? undefined : preview.buffer);
          }
        }
        const etag = `"${stat.size}-${stat.mtimeMs}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
        const headers = { 'Content-Type': TYPES[path.extname(candidate).toLowerCase()], 'Content-Length': stat.size, ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=0, must-revalidate' };
        let range;
        if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag || req.headers['if-range'] === headers['Last-Modified'])) {
          range = parseRange(req.headers.range, stat.size);
          if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' }); return res.end(); }
          headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
          headers['Content-Length'] = range.end - range.start + 1;
        }
        if (url.searchParams.has('download')) headers['Content-Disposition'] = 'attachment';
        res.writeHead(range ? 206 : 200, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(file, range || {});
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        return stream.pipe(res);
      }
      return sendJson(req, res, 404, { error: 'Not found.' });
    } catch (error) {
      if (res.headersSent) return res.destroy();
      console.error(error.message);
      return sendJson(req, res, 500, { error: 'Could not read the gallery. Check the terminal for details.' });
    }
  });
  server.thumbnailsEnabled = Boolean(thumbnail);
  return server;
}

function browserApp() {
  const $ = selector => document.querySelector(selector);
  const video = $('#video');
  const home = $('#home'), viewer = $('#viewer'), lightbox = $('#lightbox'), grid = $('#photos'), photo = $('#photo');
  let albums = [], current = null, pageData = null, page = 1, selected = 0, requestId = 0;
  const formats = ['jpg', 'png', 'gif', 'webp', 'avif', 'bmp', 'webm'];
  let enabledTypes = new Set(formats), totalImages = 0, albumsRequest = 0, thumbnailsEnabled = false;
  let sortOrder = 'name-asc', selectedItem = null;
  const sortQuery = () => sortOrder === 'name-asc' ? '' : '&sort=' + encodeURIComponent(sortOrder);
  const typeQuery = () => enabledTypes.size === formats.length ? '' : '&types=' + encodeURIComponent([...enabledTypes].join(','));
  let zoom = 1, panX = 0, panY = 0, drag = null;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const node = (tag, cls, text) => { const element = document.createElement(tag); if (cls) element.className = cls; if (text !== undefined) element.textContent = text; return element; };
  const bytes = value => { const unit = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1; return (value / unit).toLocaleString(undefined, { maximumFractionDigits: unit === 1 ? 0 : 1 }) + (unit === 1e9 ? ' GB' : unit === 1e6 ? ' MB' : unit === 1e3 ? ' KB' : ' B'); };
  async function json(url) { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data; }
  function preview(item, cover = false) {
    if ((cover ? item.coverType : item.type) === 'video') {
      const tile = node('span', 'video-preview'); tile.append(node('span', 'play-symbol', '▶'), node('span', 'video-badge', 'WEBM'));
      return tile;
    }
    const original = cover ? item.cover : item.url;
    const img = node('img'); img.loading = 'lazy'; img.decoding = 'async'; img.alt = cover ? '' : item.name; img.src = original + (thumbnailsEnabled ? '?thumbnail=1' : '');
    let usingThumbnail = thumbnailsEnabled;
    img.addEventListener('error', () => {
      if (usingThumbnail) { usingThumbnail = false; img.src = original; }
      else img.replaceWith(node('span', 'broken-image', 'Preview unavailable'));
    });
    return img;
  }
  function renderTypeFilters() {
    for (const id of ['#type-filters', '#viewer-type-filters']) {
      const container = $(id); container.replaceChildren();
      for (const type of formats) {
        const label = node('label', 'type-toggle');
        const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = enabledTypes.has(type);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) enabledTypes.add(type); else enabledTypes.delete(type);
          applyTypes();
        });
        label.append(checkbox, node('span', '', type === 'jpg' ? 'JPG / JPEG' : type.toUpperCase()));
        container.append(label);
      }
      const all = node('button', 'filter-action', 'All types'); all.type = 'button';
      all.addEventListener('click', () => { enabledTypes = new Set(formats); applyTypes(); });
      const clear = node('button', 'filter-action', 'Clear'); clear.type = 'button';
      clear.addEventListener('click', () => { enabledTypes.clear(); applyTypes(); });
      container.append(all, clear);
    }
  }
  function applyTypes() {
    for (const id of ['#type-filters', '#viewer-type-filters']) {
      formats.forEach((type, index) => { $(id).children[index].children[0].checked = enabledTypes.has(type); });
    }
    refresh(false);
    if (viewer.open) {
      lightbox.close(); imageRequest++; pageData = null;
      grid.replaceChildren();
      document.querySelectorAll('.pagination').forEach(controls => controls.replaceChildren());
      loadPage(1, true);
    }
  }
  function applySort(value) {
    sortOrder = value;
    $('#sort-order').value = value; $('#viewer-sort-order').value = value;
    applyTypes();
  }
  function renderAlbums() {
    const query = $('#search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const filtered = albums.filter(album => query.every(term => `${album.name} ${album.folder}`.toLocaleLowerCase().includes(term)));
    $('#albums').replaceChildren();
    for (const album of filtered) {
      const button = node('button', 'album'); button.type = 'button';
      const cover = node('div', 'cover'); cover.append(preview(album, true), node('span', 'open-label', 'OPEN GALLERY ↗'));
      const info = node('div', 'album-info'); info.append(node('strong', '', album.name), node('span', '', `${album.count} files · ${bytes(album.bytes)}`));
      if (album.folder) info.append(node('small', '', album.folder));
      button.append(cover, info); button.addEventListener('click', () => openAlbum(album)); $('#albums').append(button);
    }
    $('#results').textContent = query.length ? `${filtered.length} of ${albums.length} galleries match` : 'One folder. One gallery. Everything stays where it is.';
    $('#empty').hidden = filtered.length > 0;
    $('#empty-title').textContent = totalImages ? 'No matching galleries' : 'No media found yet';
    $('#empty-copy').textContent = totalImages ? 'Try another name or enable more file types.' : 'Add images or WebM videos to this folder or its subfolders, then choose Refresh folders.';
  }
  async function refresh(rescan = true) {
    const token = ++albumsRequest;
    $('#refresh').disabled = true; $('#message').textContent = rescan ? 'Scanning folders…' : 'Updating galleries…';
    try {
      const data = await json(`/api/albums?refresh=${rescan ? 1 : 0}${typeQuery()}${sortQuery()}`);
      if (token !== albumsRequest) return;
      thumbnailsEnabled = Boolean(data.thumbnails);
      albums = data.albums; totalImages = data.totalImages ?? albums.reduce((sum, album) => sum + album.count, 0);
      $('#root-name').textContent = data.root;
      $('#totals').textContent = `${albums.length} galleries · ${albums.reduce((sum, album) => sum + album.count, 0).toLocaleString()} files · ${bytes(albums.reduce((sum, album) => sum + album.bytes, 0))}`;
      $('#message').textContent = data.warnings.length ? data.warnings.join(' ') : '';
      renderAlbums();
    } catch (error) { if (token === albumsRequest) $('#message').textContent = error.message; }
    finally { if (token === albumsRequest) $('#refresh').disabled = false; }
  }
  function changePage(next) { lightbox.close(); loadPage(next, true); }
  function renderPagination() {
    for (const controls of document.querySelectorAll('.pagination')) {
      controls.replaceChildren();
      const prev = node('button', 'secondary', '← Previous'); prev.disabled = page <= 1; prev.addEventListener('click', () => changePage(page - 1));
      const numbers = node('div', 'numbers');
      const visible = Array.from({ length: pageData.pages }, (_, i) => i + 1).filter(i => pageData.pages <= 7 || i === 1 || i === pageData.pages || Math.abs(i - page) <= 2);
      let last = 0;
      for (const number of visible) {
        if (last && number - last > 1) numbers.append(node('span', 'gap', '…'));
        const button = node('button', 'number', String(number)); button.setAttribute('aria-label', `Page ${number}`);
        if (number === page) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', () => changePage(number)); numbers.append(button); last = number;
      }
      const next = node('button', 'secondary', 'Next →'); next.disabled = page >= pageData.pages; next.addEventListener('click', () => changePage(page + 1));
      const status = node('span', 'page-status', current.count ? `Page ${page} of ${pageData.pages} · ${(page - 1) * pageData.pageSize + 1}–${Math.min(page * pageData.pageSize, current.count)} of ${current.count}` : 'No matching files');
      controls.append(prev, numbers, next, status);
    }
  }
  async function loadPage(next, scroll = false) {
    const token = ++requestId;
    $('#viewer-error').textContent = '';
    viewer.setAttribute('aria-busy', 'true');
    try {
      const data = await json(`/api/gallery?id=${encodeURIComponent(current.id)}&page=${next}${typeQuery()}${sortQuery()}`);
      if (token !== requestId || !viewer.open) return false;
      current = data; pageData = data; page = data.page; grid.replaceChildren();
      data.images.forEach((item, offset) => {
        const button = node('button', 'photo-tile'); button.setAttribute('aria-label', `View ${item.name}`); button.append(preview(item));
        button.addEventListener('click', () => openImage((page - 1) * data.pageSize + offset)); grid.append(button);
      });
      $('#viewer-empty').hidden = data.count > 0;
      renderPagination();
      if (scroll) { viewer.scrollTop = 0; updateTop(); }
      return true;
    } catch (error) { if (token === requestId) $('#viewer-error').textContent = error.message; return false; }
    finally { if (token === requestId) viewer.setAttribute('aria-busy', 'false'); }
  }
  function openAlbum(album) {
    current = album; pageData = null; page = 1; grid.replaceChildren(); $('#viewer-empty').hidden = true;
    document.querySelectorAll('.pagination').forEach(controls => controls.replaceChildren());
    $('#album-title').textContent = album.name; $('#album-folder').textContent = album.folder || 'Main folder';
    viewer.showModal(); viewer.scrollTop = 0; updateTop(); loadPage(1);
  }
  function transform() { photo.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; $('#zoom-reset').textContent = `${Math.round(zoom * 100)}%`; $('#stage').classList.toggle('zoomed', zoom > 1); }
  function resetZoom() { zoom = 1; panX = panY = 0; drag = null; transform(); }
  function setZoom(value) { if (selectedItem?.type === 'video') return; zoom = Math.max(1, Math.min(5, value)); if (zoom === 1) panX = panY = 0; transform(); }
  let imageRequest = 0;
  async function openImage(index) {
    if (!current || !pageData || !current.count) return;
    video.pause();
    const token = ++imageRequest;
    const count = current.count;
    index = (index + count) % count;
    const targetPage = Math.floor(index / pageData.pageSize) + 1;
    if (targetPage !== page && !await loadPage(targetPage)) return;
    if (token !== imageRequest || !viewer.open) return;
    selected = index;
    const item = pageData.images[index % pageData.pageSize];
    stopMedia(); selectedItem = item;
    renderImageInfo(); resetZoom(); $('#image-error').hidden = true;
    const isVideo = item.type === 'video';
    photo.hidden = isVideo; video.hidden = !isVideo;
    $('#stage').classList.toggle('video-stage', isVideo);
    $('#zoom-tools').hidden = isVideo;
    const original = $('#download-video'); original.hidden = !isVideo;
    if (isVideo) {
      video.muted = true;
      video.src = item.url;
      original.href = item.url + '?download=1'; original.download = item.name;
    } else { photo.src = item.url; photo.alt = item.name; }
    $('#caption').textContent = `${item.name} · ${index + 1} of ${count}`;
    if (!lightbox.open) lightbox.showModal();
  }
  function stopMedia() {
    video.pause(); video.removeAttribute('src'); video.load();
    photo.removeAttribute('src');
  }
  function renderImageInfo(loaded = false, failed = false) {
    const details = $('#image-details'); details.replaceChildren();
    if (!selectedItem) return;
    const item = selectedItem;
    const date = item.modifiedAt ? new Date(item.modifiedAt) : null;
    const isVideo = item.type === 'video';
    const width = isVideo ? video.videoWidth : photo.naturalWidth;
    const height = isVideo ? video.videoHeight : photo.naturalHeight;
    const rows = [
      ['Filename', item.name],
      ['Folder', current?.folder || 'Main folder'],
      ['Type', item.name.split('.').pop().toUpperCase()],
      ['Dimensions', loaded && width ? `${width.toLocaleString()} × ${height.toLocaleString()} pixels` : failed ? 'Unavailable' : 'Loading…'],
      ['File size', `${bytes(item.bytes)} (${item.bytes.toLocaleString()} bytes)`],
      ['Modified', date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Unavailable']
    ];
    if (isVideo) rows.push(['Duration', loaded && Number.isFinite(video.duration) ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, '0')}` : failed ? 'Unavailable' : 'Loading…']);
    for (const [label, value] of rows) details.append(node('dt', '', label), node('dd', '', value));
  }
  function toggleImageInfo() {
    const panel = $('#image-info'); panel.hidden = !panel.hidden;
    $('#toggle-info').setAttribute('aria-expanded', String(!panel.hidden));
  }
  function updateTop() {
    $('#top-home').hidden = viewer.open || window.scrollY < 300;
    $('#top-viewer').hidden = !viewer.open || viewer.scrollTop < 300;
  }
  $('#sort-order').addEventListener('change', event => applySort(event.target.value));
  $('#viewer-sort-order').addEventListener('change', event => applySort(event.target.value));
  $('#toggle-info').addEventListener('click', toggleImageInfo);
  photo.addEventListener('load', () => { if (selectedItem?.type !== 'video') renderImageInfo(true); });
  video.addEventListener('loadedmetadata', () => { if (selectedItem?.type === 'video') renderImageInfo(true); });
  video.addEventListener('error', () => { if (selectedItem?.type !== 'video' || !video.getAttribute('src')) return; $('#image-error').hidden = false; renderImageInfo(false, true); });
  $('#refresh').addEventListener('click', () => refresh()); $('#search').addEventListener('input', renderAlbums);
  $('#close-album').addEventListener('click', () => viewer.close());
  viewer.addEventListener('close', () => { requestId++; imageRequest++; if (lightbox.open) lightbox.close(); stopMedia(); grid.replaceChildren(); current = pageData = null; updateTop(); });
  $('#close-image').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('close', () => { imageRequest++; stopMedia(); selectedItem = null; $('#image-info').hidden = true; $('#toggle-info').setAttribute('aria-expanded', 'false'); resetZoom(); });
  $('#previous-image').addEventListener('click', () => openImage(selected - 1)); $('#next-image').addEventListener('click', () => openImage(selected + 1));
  photo.addEventListener('error', () => { if (!selectedItem || selectedItem.type === 'video') return; $('#image-error').hidden = false; renderImageInfo(false, true); });
  $('#zoom-in').addEventListener('click', () => setZoom(zoom * 1.25)); $('#zoom-out').addEventListener('click', () => setZoom(zoom / 1.25)); $('#zoom-reset').addEventListener('click', resetZoom);
  $('#stage').addEventListener('wheel', event => { if (selectedItem?.type === 'video') return; event.preventDefault(); setZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
  $('#stage').addEventListener('dblclick', () => setZoom(zoom > 1 ? 1 : 2));
  $('#stage').addEventListener('pointerdown', event => { if (selectedItem?.type === 'video' || zoom <= 1 || event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, panX, panY }; $('#stage').setPointerCapture(event.pointerId); });
  $('#stage').addEventListener('pointermove', event => { if (!drag) return; panX = drag.panX + event.clientX - drag.x; panY = drag.panY + event.clientY - drag.y; transform(); });
  for (const type of ['pointerup', 'pointercancel']) $('#stage').addEventListener(type, () => { drag = null; });
  document.addEventListener('keydown', event => { if (!lightbox.open || event.target === video || event.ctrlKey || event.metaKey || event.altKey) return; if (event.key.toLowerCase() === 'i') toggleImageInfo(); if (event.key === 'ArrowLeft') { event.preventDefault(); openImage(selected - 1); } if (event.key === 'ArrowRight') { event.preventDefault(); openImage(selected + 1); } });
  for (const [button, target] of [[$('#top-home'), window], [$('#top-viewer'), viewer]]) button.addEventListener('click', () => target.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' }));
  window.addEventListener('scroll', updateTop, { passive: true }); viewer.addEventListener('scroll', updateTop, { passive: true });
  renderTypeFilters();
  refresh();
}

const sortControl = id => `<label class="sort-control" for="${id}">Sort by <select id="${id}"><option value="name-asc">Name · A–Z</option><option value="name-desc">Name · Z–A</option><option value="date-desc">Modified · newest first</option><option value="date-asc">Modified · oldest first</option><option value="size-desc">Size · largest first</option><option value="size-asc">Size · smallest first</option></select></label>`;
const HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Folder Gallery</title>
<style>
:root{--bg:#090b0e;--panel:#12161c;--line:#29303a;--text:#edf0f4;--muted:#99a4b3;--accent:#ff743d;color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}button,input{font:inherit}button{cursor:pointer}button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:4px}button{color:inherit}header{height:74px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;padding:0 clamp(20px,5vw,72px);gap:16px}.brand{display:flex;align-items:center;gap:12px;font-weight:750;letter-spacing:-.03em}.mark{display:grid;place-items:center;width:34px;height:34px;background:var(--accent);color:#140e09;font-size:12px;transform:rotate(-4deg)}.local-label{font-size:11px;letter-spacing:.16em;color:var(--muted)}main{max-width:1550px;margin:auto;padding:54px clamp(20px,5vw,72px) 80px}.intro{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:32px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.18em;color:var(--accent);margin:0 0 12px}h1{font-size:clamp(40px,6vw,72px);line-height:1;letter-spacing:-.055em;margin:0 0 16px}#totals{color:var(--muted);font-size:14px;margin:0}.secondary,.icon,.number{background:var(--panel);border:1px solid var(--line);border-radius:4px;min-height:42px;padding:0 16px}.secondary:hover,.icon:hover,.number:hover{border-color:var(--accent);color:var(--accent)}.search{display:block;max-width:700px}.search span{display:block;font-size:13px;font-weight:650;margin-bottom:10px}.search input{height:50px;width:100%;border:1px solid var(--line);background:var(--panel);padding:0 16px;color:var(--text);border-radius:5px}.muted{color:var(--muted);font-size:13px}#results{margin:12px 0 32px}#message{color:#ffb294;font-size:13px;white-space:pre-wrap}.albums{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:28px 20px}.album{text-align:left;background:transparent;border:0;padding:0;min-width:0}.cover{position:relative;aspect-ratio:4/3;overflow:hidden;border:1px solid var(--line);background:var(--panel);display:grid;place-items:center}.cover img{width:100%;height:100%;object-fit:cover;transition:transform .2s}.album:hover img{transform:scale(1.035)}.open-label{position:absolute;bottom:12px;right:12px;background:var(--accent);color:#150e09;padding:7px 10px;font-size:10px;font-weight:800;letter-spacing:.08em;opacity:0}.album:hover .open-label,.album:focus-visible .open-label{opacity:1}.album-info{padding:12px 2px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px}.album-info strong{font-size:16px;overflow-wrap:anywhere}.album-info span,.album-info small{color:var(--muted);font-size:12px}.album-info small{grid-column:1/-1;overflow-wrap:anywhere}#empty{border:1px dashed var(--line);padding:60px 24px;text-align:center}#empty h2{margin:0;font-size:24px}#empty p{color:var(--muted)}dialog{padding:0;border:0;color:var(--text)}dialog::backdrop{background:#000c}body:has(dialog[open]){overflow:hidden}.viewer{width:100%;max-width:none;height:100%;max-height:none;background:var(--bg);overflow-y:auto}.viewer-bar{position:sticky;top:0;z-index:3;padding:16px clamp(16px,4vw,52px);min-height:80px;border-bottom:1px solid var(--line);background:#090b0ef5;display:flex;align-items:center;justify-content:space-between;gap:16px}.viewer-bar h2{font-size:22px;letter-spacing:-.03em;margin:0;overflow-wrap:anywhere}.viewer-bar small{color:var(--muted);display:block;font-size:12px;overflow-wrap:anywhere}.icon{width:44px;padding:0;flex-shrink:0;font-size:24px}.pagination{display:grid;grid-template-columns:auto minmax(0,auto) auto;grid-template-areas:"previous numbers next" "status status status";justify-content:center;align-items:center;gap:12px 10px;padding:20px 0;margin:0 clamp(16px,4vw,52px);border-bottom:1px solid var(--line)}.pagination>.secondary:first-child{grid-area:previous}.pagination>.secondary:nth-of-type(2){grid-area:next}.pagination:last-of-type{border-top:1px solid var(--line);border-bottom:0}.numbers{grid-area:numbers;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px;min-width:0}.number{min-width:40px;padding:0 10px;font-size:14px;color:var(--muted)}.number[aria-current=page]{background:var(--accent);color:#150e09;border-color:var(--accent)}.gap{color:var(--muted);padding:0 4px}.page-status{grid-area:status;color:var(--muted);text-align:center;font-size:12px}.photos{columns:4 260px;column-gap:12px;padding:24px clamp(16px,4vw,52px)}.photo-tile{display:block;position:relative;width:100%;padding:0;margin-bottom:12px;background:var(--panel);border:0;break-inside:avoid;cursor:zoom-in}.photo-tile img{width:100%;display:block;min-height:60px}.broken-image{display:grid;place-items:center;min-height:150px;color:var(--muted);padding:20px;font-size:13px}#viewer-error{color:#ffb294;padding:0 24px}.lightbox{width:100%;max-width:none;height:100%;max-height:none;background:#050608;overflow:hidden}.stage{display:grid;place-items:center;width:100%;height:100%;padding:70px;overflow:hidden;touch-action:none;cursor:zoom-in}.stage.zoomed{cursor:grab}#photo{max-width:100%;max-height:calc(100dvh - 140px);object-fit:contain;transform-origin:center;user-select:none}#caption{position:fixed;bottom:16px;left:15%;width:70%;text-align:center;color:var(--muted);font-size:12px;pointer-events:none;overflow-wrap:anywhere}.lightbox-close{position:fixed;right:18px;top:18px;z-index:4}.zoom-tools{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:4;display:flex;gap:5px}.image-nav{position:fixed;top:50%;transform:translateY(-50%);z-index:3;background:#12161ca0;border:1px solid var(--line);border-radius:4px;font-size:34px;width:44px;height:62px}.previous-image{left:14px}.next-image{right:14px}#image-error{position:fixed;bottom:50px;left:15%;width:70%;text-align:center;color:#ffb294;font-size:13px}.top{position:fixed;right:20px;bottom:max(22px,env(safe-area-inset-bottom));z-index:5;border:1px solid var(--accent);border-radius:50%;width:48px;height:48px;background:var(--panel);color:var(--accent);font-size:26px;box-shadow:0 4px 18px #0008}footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media(max-width:650px){header{height:64px}.local-label{display:none}main{padding-top:32px}.intro{align-items:start;flex-direction:column}.albums{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 12px}.album-info{display:block}.album-info strong,.album-info small,.album-info span{display:block;margin-top:4px}.album-info strong{font-size:14px}.photos{columns:2 140px;padding:16px;column-gap:8px}.photo-tile{margin-bottom:8px}.pagination{grid-template-columns:1fr 1fr;grid-template-areas:"numbers numbers" "previous next" "status status"}.pagination>.secondary:first-child{justify-self:end}.pagination>.secondary:nth-of-type(2){justify-self:start}.stage{padding:70px 54px}.image-nav{width:36px}.previous-image{left:8px}.next-image{right:8px}.viewer-bar h2{font-size:18px}}
.format-filter{border:0;padding:0;margin:22px 0 0;min-width:0}.format-filter legend{font-size:12px;font-weight:650;color:var(--muted);margin-bottom:10px}.type-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.type-toggle{display:flex;align-items:center;gap:7px;min-height:38px;padding:6px 12px;background:var(--panel);border:1px solid var(--line);border-radius:4px;cursor:pointer;font-size:12px}.type-toggle:has(input:checked){border-color:var(--accent);color:var(--accent)}.type-toggle input{accent-color:var(--accent);margin:0}.filter-action{background:transparent;border:0;color:var(--muted);padding:8px;font-size:12px;text-decoration:underline}.filter-action:hover{color:var(--text)}.viewer-filter{margin:20px clamp(16px,4vw,52px) 0}.viewer-empty{padding:24px clamp(16px,4vw,52px)}
.sort-control{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-top:20px}.sort-control select{min-height:42px;max-width:100%;padding:0 12px;background:var(--panel);border:1px solid var(--line);border-radius:4px;color:var(--text);font:inherit}.sort-control select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.viewer-sort{margin:0 clamp(16px,4vw,52px)}.info-toggle{position:fixed;top:18px;left:18px;z-index:5}.image-info{position:fixed;z-index:5;right:20px;bottom:64px;width:min(330px,calc(100% - 40px));max-height:calc(100dvh - 150px);overflow:auto;padding:20px;background:#12161cf5;border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 30px #0009}.image-info h3{margin:0 0 16px;font-size:16px}.image-info dl{margin:0;display:grid;gap:4px}.image-info dt{color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase}.image-info dd{margin:0 0 10px;font-size:13px;overflow-wrap:anywhere;user-select:text}@media(max-width:650px){.info-toggle{top:70px;left:12px}.image-info{max-height:40dvh;right:16px;bottom:64px;width:calc(100% - 32px)}}
.video-preview{position:relative;display:grid;place-content:center;gap:12px;min-height:180px;width:100%;height:100%;background:linear-gradient(145deg,#171e29,#0b0f14);text-align:center}.play-symbol{font-size:40px;color:var(--accent)}.video-badge{font-size:11px;letter-spacing:.16em;color:var(--muted)}#video{max-width:100%;max-height:calc(100dvh - 180px);width:auto}.stage.video-stage{cursor:default;touch-action:auto;align-content:center;gap:12px}.download-video{font-size:13px;color:var(--accent)}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<header><div class="brand"><span class="mark">FG</span>Folder Gallery</div><span class="local-label">LOCAL FILES · SIMPLE PLEASURES</span></header>
<main id="home"><section class="intro"><div><p class="eyebrow">YOUR LOCAL COLLECTION · <span id="root-name">FOLDERS</span></p><h1>A place for your pictures.</h1><p id="totals">Discovering your galleries…</p></div><button id="refresh" class="secondary" type="button">↻ Refresh folders</button></section>
<label class="search"><span>Find a gallery</span><input id="search" type="search" placeholder="Search folder names…" autocomplete="off" aria-controls="albums" aria-describedby="results"></label>${sortControl('sort-order')}<fieldset class="format-filter"><legend>File types</legend><div id="type-filters" class="type-filters"></div></fieldset><p id="results" class="muted" role="status"></p><p id="message" role="status"></p>
<div id="albums" class="albums"></div><section id="empty" hidden><h2 id="empty-title"></h2><p id="empty-copy"></p></section><footer>Made from your folders. No uploads. No imports. Your originals stay untouched.</footer></main>
<button id="top-home" class="top" aria-label="Back to top" title="Back to top" hidden>↑</button>
<dialog id="viewer" class="viewer" aria-labelledby="album-title"><div class="viewer-bar"><div><small id="album-folder"></small><h2 id="album-title"></h2></div><button id="close-album" class="secondary" type="button">← Galleries</button></div><div class="viewer-sort">${sortControl('viewer-sort-order')}</div><fieldset class="format-filter viewer-filter"><legend>File types</legend><div id="viewer-type-filters" class="type-filters"></div></fieldset><nav class="pagination" aria-label="Gallery pages at top"></nav><p id="viewer-error" role="alert"></p><p id="viewer-empty" class="muted viewer-empty" role="status" hidden>No files match these types. Enable a type above or choose All types.</p><div id="photos" class="photos"></div><nav class="pagination" aria-label="Gallery pages at bottom"></nav><button id="top-viewer" class="top" aria-label="Back to top of gallery" title="Back to top" hidden>↑</button></dialog>
<dialog id="lightbox" class="lightbox" aria-label="Full-screen media"><button id="toggle-info" class="secondary info-toggle" type="button" aria-controls="image-info" aria-expanded="false" title="File information (I)">ⓘ Info</button><aside id="image-info" class="image-info" aria-label="File information" hidden><h3>File information</h3><dl id="image-details"></dl></aside><button id="close-image" class="icon lightbox-close" aria-label="Close media">×</button><div id="zoom-tools" class="zoom-tools" aria-label="Image zoom"><button id="zoom-out" class="icon" aria-label="Zoom out">−</button><button id="zoom-reset" class="secondary" aria-label="Reset zoom">100%</button><button id="zoom-in" class="icon" aria-label="Zoom in">+</button></div><button id="previous-image" class="image-nav previous-image" aria-label="Previous item">‹</button><figure id="stage" class="stage" style="margin:0"><img id="photo" alt="" draggable="false"><video id="video" controls playsinline muted preload="metadata" hidden></video><a id="download-video" class="download-video" hidden>Download original WebM</a><figcaption id="caption"></figcaption></figure><p id="image-error" role="alert" hidden>This file cannot be displayed. It may have moved or be unsupported by your browser. For a video, try downloading the original.</p><button id="next-image" class="image-nav next-image" aria-label="Next item">›</button></dialog>
<script>(${browserApp.toString()})();</script></body></html>`;

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Folder Gallery\n\nUsage: node gallery.js [folder] [--port 4180] [--host 127.0.0.1] [--no-thumbnails]\n\nDefaults to the folder containing gallery.js. Opens a read-only local web server.\nSupports JPG, PNG, GIF, WebP, AVIF, BMP and WebM. For LAN access, use --host 0.0.0.0.\nOptional Sharp enables cached image previews; --no-thumbnails disables them.\nInstall beside gallery.js: npm install --no-save --package-lock=false sharp\nPress Ctrl+C to stop.');
    return;
  }
  let root = __dirname, port = 4180, host = '127.0.0.1', hasRoot = false, thumbnails = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Use --port with a number from 0 to 65535.');
      port = Number(value);
    } else if (args[i] === '--host') {
      host = args[++i];
      if (!host || !['127.0.0.1', '0.0.0.0', ...localAddresses()].includes(host)) throw new Error('Use --host 127.0.0.1, 0.0.0.0, or this computer’s local IPv4 address.');
    } else if (args[i] === '--no-thumbnails') thumbnails = false;
    else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}. Run with --help.`);
    else if (!hasRoot) { root = path.resolve(args[i]); hasRoot = true; }
    else throw new Error('Supply only one gallery folder. Run with --help.');
  }
  const server = await createGallery(root, { host, thumbnails });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try --port ${port + 1}.` : error.message); process.exitCode = 1; });
  server.listen(port, host, () => {
    const networkUrls = host === '127.0.0.1' ? '' : '\nNetwork: ' + (host === '0.0.0.0' ? localAddresses() : [host]).map(address => `http://${address}:${server.address().port}`).join('\n         ');
    const thumbnailStatus = server.thumbnailsEnabled ? `Thumbnail acceleration enabled\nCache: ${thumbnailCacheDirectory()} (512 MiB limit)` : thumbnails ? 'Thumbnails: off (optional Sharp not available)' : 'Thumbnails: disabled';
    console.log(`\nFolder Gallery\nFolder: ${path.resolve(root)}\nOpen:   http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.address().port}${networkUrls}\n${thumbnailStatus}\n\nPress Ctrl+C to stop. Your original files are never modified.\n`);
  });
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error('Folder Gallery: ' + error.message); process.exitCode = 1; });
module.exports = { createGallery, scanFolders, parseRange, createThumbnailCache, thumbnailCacheDirectory, HTML };
