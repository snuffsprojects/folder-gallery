const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createGallery, scanFolders, parseRange, HTML } = require('./gallery');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-gallery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('each folder is separate, sorted naturally, with no hidden or symlinked files', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'Trips/Nested'), { recursive: true });
  await fs.mkdir(path.join(root, '.private'));
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'dependency.png'), 'package-image');
  for (const file of ['root.jpg', 'Trips/10.jpg', 'Trips/2.jpg', 'Trips/Nested/snow.PNG', '.private/no.jpg', '.secret.jpg', 'notes.txt']) await fs.writeFile(path.join(root, file), 'abc');
  await fs.symlink(path.join(root, 'root.jpg'), path.join(root, 'linked.jpg'));
  const { albums, warnings } = await scanFolders(root);
  assert.equal(albums.size, 3);
  assert.equal(albums.get('.').name, 'Main folder');
  assert.equal(albums.get('.').count, 1);
  assert.deepEqual(albums.get('Trips').images.map(item => item.name), ['2.jpg', '10.jpg']);
  assert.equal(albums.get('Trips/Nested').count, 1);
  assert.equal(albums.get('Trips').bytes, 6);
  assert.deepEqual(warnings, []);
});

test('embedded browser code parses as JavaScript', () => {
  const source = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(source));
});

test('read-only HTTP gallery pages, encoded filenames, cache, refresh and access boundaries', async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.mkdir(path.join(root, 'A & B'));
  const special = 'a # % ? café.jpg';
  await fs.writeFile(path.join(root, 'A & B', special), 'special-image');
  for (let i = 1; i <= 65; i++) await fs.writeFile(path.join(root, `photo${i}.png`), 'abc');
  await fs.writeFile(path.join(outside, 'outside.jpg'), 'outside');
  await fs.symlink(path.join(outside, 'outside.jpg'), path.join(root, 'escape.jpg'));
  await fs.writeFile(path.join(root, '.secret.jpg'), 'hidden');
  await fs.writeFile(path.join(root, 'private.txt'), 'private');
  const server = await createGallery(root, { thumbnails: false });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = route => fetch(base + route);
  const albums = await (await get('/api/albums')).json();
  assert.equal(albums.albums.length, 2);
  assert.equal(albums.albums[0].images, undefined);
  const first = await (await get('/api/gallery?id=.&page=1')).json();
  assert.equal(first.images.length, 30); assert.equal(first.pages, 3);
  assert.equal(first.images[0].name, 'photo1.png');
  const last = await (await get('/api/gallery?id=.&page=3')).json();
  assert.equal(last.images.length, 5);
  assert.equal(last.images[4].name, 'photo65.png');
  for (const page of ['0', '-1', '1.5', '4', 'NaN']) assert.equal((await get('/api/gallery?id=.&page=' + page)).status, 400);
  assert.equal((await get('/api/gallery?id=missing')).status, 404);
  const specialAlbum = await (await get('/api/gallery?id=A%20%26%20B')).json();
  const image = await get(specialAlbum.images[0].url);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(await image.text(), 'special-image');
  const cached = await fetch(base + specialAlbum.images[0].url, { headers: { 'If-None-Match': image.headers.get('etag') } });
  assert.equal(cached.status, 304);
  const head = await fetch(base + first.images[0].url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '3'); assert.equal(await head.text(), '');
  for (const route of ['/media/escape.jpg', '/media/.secret.jpg', '/media/private.txt', '/media/%2e%2e%2foutside.jpg']) assert.equal((await get(route)).status, 404);
  const badHostStatus = await new Promise((resolve, reject) => {
    require('node:http').get(base + '/', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(base + '/', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.match(await (await get('/')).text(), /A place for your pictures/);
  await fs.writeFile(path.join(root, 'new.jpg'), 'new');
  assert.equal((await (await get('/api/gallery?id=.')).json()).count, 65);
  await get('/api/albums?refresh=1');
  assert.equal((await (await get('/api/gallery?id=.')).json()).count, 66);
  assert.equal(await fs.readFile(path.join(root, 'private.txt'), 'utf8'), 'private');
  await fs.mkdir(path.join(root, 'Mixed'));
  for (let i = 1; i <= 35; i++) {
    await fs.writeFile(path.join(root, 'Mixed', `photo${i}.JPEG`), 'jpeg');
    await fs.writeFile(path.join(root, 'Mixed', `photo${i}.png`), 'png');
  }
  await get('/api/albums?refresh=1');
  const jpgAlbums = await (await get('/api/albums?types=jpg')).json();
  const mixed = jpgAlbums.albums.find(album => album.id === 'Mixed');
  assert.equal(mixed.count, 35); assert.equal(mixed.bytes, 140);
  assert.match(mixed.cover, /JPEG$/);
  const filtered = await (await get('/api/gallery?id=Mixed&types=jpg&page=2')).json();
  assert.equal(filtered.count, 35); assert.equal(filtered.pages, 2);
  assert.equal(filtered.images.length, 5);
  assert.ok(filtered.images.every(item => item.name.endsWith('.JPEG')));
  assert.equal((await (await get('/api/gallery?id=Mixed&types=jpeg')).json()).count, 35);
  const png = await (await get('/api/gallery?id=Mixed&types=png')).json();
  assert.equal(png.count, 35); assert.ok(png.images.every(item => item.name.endsWith('.png')));
  assert.equal((await (await get('/api/gallery?id=Mixed')).json()).count, 70);
  const noTypes = await (await get('/api/albums?types=')).json();
  assert.deepEqual(noTypes.albums, []);
  assert.ok(noTypes.totalImages > 0);
  const noMatches = await (await get('/api/gallery?id=Mixed&types=gif')).json();
  assert.equal(noMatches.count, 0); assert.deepEqual(noMatches.images, []); assert.equal(noMatches.pages, 1);
  await fs.mkdir(path.join(root, 'Ordered'));
  const samples = [ ['image2.jpg', 2, '2020-01-01'], ['image10.jpg', 10, '2022-01-01'], ['image1.jpg', 5, '2021-01-01'] ];
  for (const [name, size, date] of samples) {
    const file = path.join(root, 'Ordered', name);
    await fs.writeFile(file, 'x'.repeat(size));
    await fs.utimes(file, new Date(date), new Date(date));
  }
  await get('/api/albums?refresh=1');
  const orders = {
    'name-asc': ['image1.jpg', 'image2.jpg', 'image10.jpg'],
    'name-desc': ['image10.jpg', 'image2.jpg', 'image1.jpg'],
    'date-desc': ['image10.jpg', 'image1.jpg', 'image2.jpg'],
    'date-asc': ['image2.jpg', 'image1.jpg', 'image10.jpg'],
    'size-desc': ['image10.jpg', 'image1.jpg', 'image2.jpg'],
    'size-asc': ['image2.jpg', 'image1.jpg', 'image10.jpg']
  };
  for (const [sort, expected] of Object.entries(orders)) {
    const result = await (await get('/api/gallery?id=Ordered&sort=' + sort)).json();
    assert.deepEqual(result.images.map(item => item.name), expected);
    assert.ok(result.images.every(item => item.modifiedAt && Number.isFinite(item.modifiedMs)));
    const summary = (await (await get('/api/albums?sort=' + sort)).json()).albums.find(item => item.id === 'Ordered');
    assert.ok(summary.cover.endsWith(expected[0]));
  }
  const reversePage = await (await get('/api/gallery?id=Mixed&types=jpg&sort=name-desc&page=2')).json();
  assert.deepEqual(reversePage.images.map(item => item.name), ['photo5.JPEG', 'photo4.JPEG', 'photo3.JPEG', 'photo2.JPEG', 'photo1.JPEG']);
  const sizeAlbums = (await (await get('/api/albums?sort=size-desc')).json()).albums;
  assert.deepEqual(sizeAlbums.map(item => item.bytes), sizeAlbums.map(item => item.bytes).sort((a, b) => b - a));
  assert.equal((await get('/api/gallery?id=Ordered&sort=random')).status, 400);
  await fs.mkdir(path.join(root, 'Videos'));
  await fs.writeFile(path.join(root, 'Videos', 'clip.WEBM'), '0123456789');
  await get('/api/albums?refresh=1');
  const videos = (await (await get('/api/albums?types=webm')).json()).albums;
  assert.equal(videos.length, 1); assert.equal(videos[0].coverType, 'video');
  assert.equal(videos[0].count, 1);
  const clips = await (await get('/api/gallery?id=Videos&types=webm')).json();
  assert.equal(clips.images[0].type, 'video');
  const clipUrl = base + clips.images[0].url;
  const clip = await fetch(clipUrl, { headers: { Range: 'bytes=2-5' } });
  assert.equal(clip.status, 206); assert.equal(await clip.text(), '2345');
  assert.equal(clip.headers.get('content-type'), 'video/webm');
  assert.equal(clip.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(clip.headers.get('content-length'), '4');
  assert.equal(clip.headers.get('accept-ranges'), 'bytes');
  assert.equal(await (await fetch(clipUrl, { headers: { Range: 'bytes=-3' } })).text(), '789');
  assert.equal(await (await fetch(clipUrl, { headers: { Range: 'bytes=5-' } })).text(), '56789');
  assert.equal((await fetch(clipUrl, { headers: { Range: 'bytes=10-' } })).status, 416);
  const staleRange = await fetch(clipUrl, { headers: { Range: 'bytes=2-5', 'If-Range': '"old"' } });
  assert.equal(staleRange.status, 200); assert.equal(await staleRange.text(), '0123456789');
  const rangedHead = await fetch(clipUrl, { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
  assert.equal(rangedHead.status, 206); assert.equal(await rangedHead.text(), '');
  assert.equal((await fetch(clipUrl + '?download=1')).headers.get('content-disposition'), 'attachment');



});

test('browser search, page controls, cross-page viewing, zoom and close', async () => {
  const elements = new Map();
  function element(tag = 'div') {
    return {
      pauses: 0, loads: 0, pause() { this.pauses++; }, load() { this.loads++; }, getAttribute(key) { return this[key] ?? null; },
      tagName: tag, value: '', children: [], handlers: {}, hidden: false, open: false, scrollTop: 0, style: {},
      classList: { toggle() {}, add() {} },
      setAttribute(key, value) { this[key] = value; },
      removeAttribute(key) { delete this[key]; },
      append(...items) { this.children.push(...items); },
      prepend(...items) { this.children.unshift(...items); },
      remove() { this.removed = true; },
      replaceChildren(...items) { this.children = items; },
      replaceWith(replacement) { this.replacement = replacement; },
      addEventListener(type, callback) { this.handlers[type] = callback; },
      showModal() { this.open = true; },
      close() { if (this.open) { this.open = false; this.handlers.close?.(); } },
      scrollTo({ top }) { this.scrollTop = top; }
    };
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const controls = [element('nav'), element('nav')];
  const album = { id: 'Trips', name: 'Trips', folder: 'Trips', count: 65, bytes: 195, cover: '/media/1.jpg' };
  const requests = [];
  let videoMode = false, videoPreviews = false;
  const document = { querySelector: $, querySelectorAll: () => controls, createElement: element, addEventListener(type, callback) { this[type] = callback; } };
  const context = vm.createContext({
    document, window: { scrollY: 0, addEventListener() {}, scrollTo() {} },
    matchMedia: () => ({ matches: false }),
    fetch: async url => {
      requests.push(url);
      const parsed = new URL(url, 'http://localhost');
      const page = Number(parsed.searchParams.get('page') || 1);
      const matches = !parsed.searchParams.has('types') || parsed.searchParams.get('types').split(',').includes('jpg');
      const data = parsed.pathname === '/api/albums'
        ? { root: 'Photos', thumbnails: true, videoThumbnails: videoPreviews, albums: matches ? [album] : [], warnings: [], totalImages: 65 }
        : { ...album, count: matches ? 65 : 0, page, pages: matches ? 3 : 1, pageSize: 30, images: matches ? Array.from({ length: page === 3 ? 5 : 30 }, (_, i) => ({ type: videoMode && (page - 1) * 30 + i + 1 === 31 ? 'video' : 'image', name: videoMode && (page - 1) * 30 + i + 1 === 31 ? 'clip.webm' : `photo${(page - 1) * 30 + i + 1}.jpg`, bytes: 3, modifiedAt: '2026-01-02T03:04:05.000Z', url: videoMode && (page - 1) * 30 + i + 1 === 31 ? '/media/clip.webm' : `/media/${(page - 1) * 30 + i + 1}.jpg` })) : [] };
      return { ok: true, json: async () => data };
    }
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  $('#image-info').hidden = true;
  vm.runInContext(HTML.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await settle();
  assert.equal($('#albums').children.length, 1);
  const cover = $('#albums').children[0].children[0].children[0];
  assert.equal(cover.src, '/media/1.jpg?thumbnail=1');
  cover.handlers.error();
  assert.equal(cover.src, '/media/1.jpg');
  cover.handlers.error();
  assert.equal(cover.replacement.textContent, 'Preview unavailable');
  $('#search').value = 'missing'; $('#search').handlers.input();
  assert.equal($('#albums').children.length, 0); assert.equal($('#empty').hidden, false);
  $('#search').value = 'trips'; $('#search').handlers.input();
  $('#albums').children[0].handlers.click(); await settle();
  assert.equal($('#photos').children.length, 30);
  assert.equal($('#photos').children[0].children[0].src, '/media/1.jpg?thumbnail=1');
  assert.equal(controls[0].children[0].disabled, true);
  controls[1].children[2].handlers.click(); await settle();
  assert.equal($('#photos').children.length, 30);
  assert.match(controls[0].children[3].textContent, /Page 2 of 3/);
  $('#photos').children[29].handlers.click(); await settle();
  assert.equal($('#lightbox').open, true);
  assert.equal($('#photo').src, '/media/60.jpg');
  $('#toggle-info').handlers.click();
  assert.equal($('#image-info').hidden, false);
  assert.equal($('#toggle-info')['aria-expanded'], 'true');
  assert.equal($('#image-details').children[1].textContent, 'photo60.jpg');
  assert.match($('#image-details').children[9].textContent, /3 bytes/);
  $('#photo').naturalWidth = 1920; $('#photo').naturalHeight = 1080;
  $('#photo').handlers.load();
  assert.match($('#image-details').children[7].textContent, /1,920 × 1,080 pixels/);

  $('#next-image').handlers.click(); await settle();
  assert.equal($('#photo').src, '/media/61.jpg');
  assert.equal($('#image-details').children[1].textContent, 'photo61.jpg');
  assert.equal($('#image-details').children[7].textContent, 'Loading…');
  assert.equal($('#photos').children.length, 5);
  assert.equal(controls[1].children[2].disabled, true);
  document.keydown({ key: 'ArrowLeft', preventDefault() {} }); await settle();
  assert.equal($('#photo').src, '/media/60.jpg');
  $('#zoom-in').handlers.click(); assert.match($('#photo').style.transform, /scale\(1.25\)/);
  $('#close-image').handlers.click(); assert.equal($('#photo').src, undefined);
  assert.ok($('#type-filters').children.slice(0, 7).every(label => label.children[0].checked));
  // Disable JPEG from the viewer: no matches, both sets of toggles stay synchronized.
  const jpgToggle = $('#viewer-type-filters').children[0].children[0];
  jpgToggle.checked = false; jpgToggle.handlers.change(); await settle();
  assert.equal($('#type-filters').children[0].children[0].checked, false);
  assert.equal($('#photos').children.length, 0);
  assert.equal($('#viewer-empty').hidden, false);
  assert.equal($('#albums').children.length, 0);
  assert.equal(controls[0].children[3].textContent, 'No matching files');
  // Clear then select just JPG/JPEG, resetting the gallery to its first page.
  $('#viewer-type-filters').children[8].handlers.click(); await settle();
  const onlyJpg = $('#viewer-type-filters').children[0].children[0];
  onlyJpg.checked = true; onlyJpg.handlers.change(); await settle();
  assert.equal($('#photos').children.length, 30);
  assert.equal($('#viewer-empty').hidden, true);
  assert.match(controls[0].children[3].textContent, /Page 1 of 3/);
  assert.ok(requests.includes('/api/gallery?id=Trips&page=1&types=jpg'));
  $('#viewer-type-filters').children[7].handlers.click(); await settle();
  assert.ok($('#type-filters').children.slice(0, 7).every(label => label.children[0].checked));

  $('#viewer-sort-order').handlers.change({ target: { value: 'size-desc' } }); await settle();
  assert.equal($('#sort-order').value, 'size-desc');
  assert.ok(requests.includes('/api/gallery?id=Trips&page=1&sort=size-desc'));
  assert.match(controls[0].children[3].textContent, /Page 1 of 3/);
  videoMode = true;
  $('#photos').children[29].handlers.click(); await settle();
  $('#next-image').handlers.click(); await settle();
  const video = $('#video');
  assert.equal(video.src, '/media/clip.webm');
  assert.equal(video.hidden, false);
  assert.equal(video.autoplay, undefined);
  assert.equal(video.muted, true);
  assert.equal($('#photo').hidden, true);
  assert.equal($('#photo').src, undefined);
  assert.equal($('#zoom-tools').hidden, true);
  assert.equal($('#photos').children[0].children[0].className, 'video-preview');
  assert.equal($('#download-video').href, '/media/clip.webm?download=1');
  video.videoWidth = 1280; video.videoHeight = 720; video.duration = 95.5;
  video.handlers.loadedmetadata();
  assert.match($('#image-details').children[7].textContent, /1,280 × 720/);
  assert.equal($('#image-details').children[13].textContent, '1:35');
  const pauses = video.pauses;
  $('#next-image').handlers.click(); await settle();
  assert.equal(video.src, undefined); assert.ok(video.pauses > pauses);
  assert.equal($('#zoom-tools').hidden, false);
  $('#previous-image').handlers.click(); await settle();
  assert.equal(video.src, '/media/clip.webm');
  $('#close-image').handlers.click();
  assert.equal(video.src, undefined); assert.ok(video.loads > 0);
  videoPreviews = true;
  $('#refresh').handlers.click(); await settle();
  // Reload a gallery page after capability detection: videos get an image,
  // never a second video player. Broken thumbnails fall back to the badge.
  controls[0].children[0].handlers.click(); await settle();
  controls[0].children[2].handlers.click(); await settle();
  const videoTile = $('#photos').children[0].children[0];
  assert.equal(videoTile.children[0].tagName, 'img');
  assert.equal(videoTile.children[0].src, '/media/clip.webm?thumbnail=1');
  videoTile.children[0].handlers.error();
  assert.equal(videoTile.children[0].removed, true);
  assert.equal(videoTile.children[1].textContent, '▶');
  $('#close-album').handlers.click(); assert.equal($('#viewer').open, false);
  assert.ok(requests.includes('/api/gallery?id=Trips&page=3'));
});


test('single byte ranges validate suffixes and bounds', () => {
  assert.deepEqual(parseRange('bytes=0-99', 10), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=-99', 10), { start: 0, end: 9 });
  for (const header of ['bytes=-0', 'bytes=5-2', 'bytes=-', 'bytes=1-2,5-6', 'bytes=9007199254740992-']) assert.equal(parseRange(header, 10), null);
  assert.equal(parseRange('bytes=0-', 0), null);
});

test('network mode accepts this computer’s IP while rejecting foreign hosts and origins', async t => {
  const root = await fixture(t);
  const address = Object.values(require('node:os').networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;
  if (!address) { t.skip('No network interface available'); return; }
  for (const networkMode of [false, true]) {
    const server = await createGallery(root, { host: networkMode ? '0.0.0.0' : '127.0.0.1', thumbnails: false });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const port = server.address().port;
    const status = headers => new Promise((resolve, reject) => {
      require('node:http').get(`http://127.0.0.1:${port}/`, { headers }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(await status({ Host: `${address}:${port}` }), networkMode ? 200 : 403);
    assert.equal(await status({ Host: 'evil.example' }), 403);
    assert.equal(await status({ Host: `${address}:${port}`, Origin: 'https://evil.example' }), 403);
    if (networkMode) assert.equal(await status({ Host: `${address}:${port}`, Origin: `http://${address}:${port}` }), 200);
  }
});

test('CLI network mode prints usable URLs and serves the chosen folder', async t => {
  const root = await fixture(t);
  const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'gallery.js'), root, '--port', '0', '--host', '0.0.0.0', '--no-thumbnails'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done; }
  });
  const startup = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => reject(new Error('CLI startup timed out: ' + errors)), 10000);
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited ${code}: ${errors}`)); });
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/Open:\s+(http:\/\/127\.0\.0\.1:(\d+))/); if (match) { clearTimeout(timer); resolve({ output, url: match[1], port: match[2] }); } });
  });
  assert.equal((await fetch(startup.url)).status, 200);
  assert.match(startup.output, /Thumbnails: disabled/);
  assert.equal((await (await fetch(startup.url + '/api/albums')).json()).thumbnails, false);
  const address = Object.values(require('node:os').networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;
  if (address) {
    assert.ok(startup.output.includes(`http://${address}:${startup.port}`));
    assert.equal((await fetch(`http://${address}:${startup.port}/api/albums`)).status, 200);
  }
});
