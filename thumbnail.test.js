'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createGallery, createThumbnailCache } = require('./gallery');
const sharp = process.env.FOLDER_GALLERY_TEST_SHARP ? require('sharp') : null;

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-gallery-thumbnails-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function processor(render) {
  return file => ({
    rotate() { return this; }, resize() { return this; }, webp() { return this; },
    toBuffer() { return render(file); }
  });
}

async function serve(t, root, options) {
  const server = await createGallery(root, { ffmpeg: null, ...options });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('thumbnail cache is lazy, deduplicates work, limits decoders and survives restart', async t => {
  const dir = await fixture(t), cacheDir = path.join(dir, 'cache');
  const files = Array.from({ length: 6 }, (_, i) => path.join(dir, `photo${i}.jpg`));
  await Promise.all(files.map(file => fs.writeFile(file, 'original')));
  let calls = 0, active = 0, peak = 0;
  const render = processor(async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--; return Buffer.from('small-preview');
  });
  const thumbnail = createThumbnailCache(render, { cacheDir });
  await assert.rejects(fs.stat(cacheDir), { code: 'ENOENT' });
  const stats = await Promise.all(files.map(file => fs.stat(file)));
  const first = thumbnail(files[0], stats[0]);
  assert.equal(thumbnail(files[0], stats[0]), first);
  const results = await Promise.all([first, ...files.slice(1).map((file, i) => thumbnail(file, stats[i + 1]))]);
  assert.equal(calls, 6); assert.equal(peak, 2);
  assert.ok(results.every(result => result.buffer.toString() === 'small-preview'));
  const restarted = createThumbnailCache(render, { cacheDir });
  assert.deepEqual(await restarted(files[0], stats[0]), results[0]);
  assert.equal(calls, 6);
  await fs.writeFile(files[0], 'changed-original');
  const changed = await restarted(files[0], await fs.stat(files[0]));
  assert.notEqual(changed.etag, results[0].etag); assert.equal(calls, 7);
  assert.equal(await fs.readFile(files[0], 'utf8'), 'changed-original');
});

test('cache enforces its size budget, evicts old entries and preserves unrelated files', async t => {
  const dir = await fixture(t), cacheDir = path.join(dir, 'cache');
  await fs.mkdir(cacheDir);
  await fs.writeFile(path.join(cacheDir, 'leave-me.txt'), 'unrelated');
  const old = 'a'.repeat(64) + '.webp';
  await fs.writeFile(path.join(cacheDir, old), 'old-cache-entry');
  const file = path.join(dir, 'photo.jpg'); await fs.writeFile(file, 'original');
  const thumbnail = createThumbnailCache(processor(async () => Buffer.from('12345')), { cacheDir, maxBytes: 10 });
  for (const size of [1, 2, 3]) await thumbnail(file, { size, mtimeMs: size, ctimeMs: size });
  const names = await fs.readdir(cacheDir);
  assert.equal(names.filter(name => name.endsWith('.webp')).length, 2);
  assert.ok(!names.includes(old));
  assert.equal(await fs.readFile(path.join(cacheDir, 'leave-me.txt'), 'utf8'), 'unrelated');
  assert.ok(names.every(name => !name.endsWith('.tmp')));
  // Another process deleting a cached entry is harmless: regenerate it.
  await Promise.all(names.filter(name => name.endsWith('.webp')).map(name => fs.unlink(path.join(cacheDir, name))));
  assert.equal((await thumbnail(file, { size: 3, mtimeMs: 3, ctimeMs: 3 })).buffer.toString(), '12345');
});

test('preview HTTP requests preserve originals, validators, paths and video behaviour', async t => {
  const root = await fixture(t), elsewhere = await fixture(t), cacheDir = path.join(elsewhere, 'cache');
  const filename = 'a # % ? café.jpg';
  await fs.writeFile(path.join(root, filename), 'original-image');
  await fs.writeFile(path.join(root, 'clip.webm'), '0123456789');
  await fs.writeFile(path.join(root, '.hidden.jpg'), 'private');
  await fs.writeFile(path.join(elsewhere, 'outside.jpg'), 'private');
  await fs.symlink(path.join(elsewhere, 'outside.jpg'), path.join(root, 'escape.jpg'));
  let calls = 0;
  const base = await serve(t, root, { cacheDir, sharp: processor(async () => { calls++; return Buffer.from('preview'); }) });
  const albums = await (await fetch(base + '/api/albums')).json();
  assert.equal(albums.thumbnails, true); assert.equal(calls, 0);
  await assert.rejects(fs.stat(cacheDir), { code: 'ENOENT' });
  const url = base + '/media/' + encodeURIComponent(filename);
  const preview = await fetch(url + '?thumbnail=1');
  assert.equal(preview.headers.get('content-type'), 'image/webp');
  assert.equal(await preview.text(), 'preview'); assert.equal(calls, 1);
  const original = await fetch(url);
  assert.equal(await original.text(), 'original-image');
  assert.notEqual(original.headers.get('etag'), preview.headers.get('etag'));
  const cached = await fetch(url + '?thumbnail=1', { headers: { 'If-None-Match': preview.headers.get('etag') } });
  assert.equal(cached.status, 304); assert.equal(calls, 1);
  const head = await fetch(url + '?thumbnail=1', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '7'); assert.equal(await head.text(), '');
  const download = await fetch(url + '?thumbnail=1&download=1');
  assert.equal(await download.text(), 'original-image'); assert.equal(download.headers.get('content-disposition'), 'attachment');
  assert.equal((await fetch(base + '/media/clip.webm?thumbnail=1')).status, 404);
  const video = await fetch(base + '/media/clip.webm', { headers: { Range: 'bytes=2-5' } });
  assert.equal(video.status, 206); assert.equal(await video.text(), '2345'); assert.equal(calls, 1);
  for (const name of ['.hidden.jpg', 'escape.jpg', '../outside.jpg']) {
    assert.equal((await fetch(base + '/media/' + encodeURIComponent(name) + '?thumbnail=1')).status, 404);
  }
  assert.equal((await fetch(base + '/media/photo.jpg?thumbnail=1', { headers: { Origin: 'https://evil.example' } })).status, 403);
  await fs.writeFile(path.join(root, filename), 'updated-original-image');
  const changed = await fetch(url + '?thumbnail=1', { headers: { 'If-None-Match': preview.headers.get('etag') } });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), preview.headers.get('etag')); assert.equal(calls, 2);
  assert.deepEqual((await fs.readdir(root)).sort(), [filename, 'clip.webm', '.hidden.jpg', 'escape.jpg'].sort());
});

test('missing Sharp, explicit disable, decoder failure and cache failure all serve originals', async t => {
  const root = await fixture(t), elsewhere = await fixture(t);
  await fs.writeFile(path.join(root, 'photo.jpg'), 'original');
  const blockedCache = path.join(elsewhere, 'not-a-directory'); await fs.writeFile(blockedCache, 'file');
  const scenarios = [
    { sharp: null },
    { thumbnails: false, sharp: processor(() => { throw new Error('Must not run'); }) },
    { sharp: processor(() => { throw new Error('Unsupported image'); }), cacheDir: path.join(elsewhere, 'cache') },
    { sharp: processor(async () => Buffer.from('preview')), cacheDir: blockedCache }
  ];
  for (const options of scenarios) {
    const base = await serve(t, root, options);
    const response = await fetch(base + '/media/photo.jpg?thumbnail=1');
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(await response.text(), 'original');
    assert.equal(await fs.readFile(path.join(root, 'photo.jpg'), 'utf8'), 'original');
  }
});

test('a standalone copy starts normally when Sharp is not installed beside it', async t => {
  const root = await fixture(t), cacheDir = path.join(root, '.unused-cache');
  const script = path.join(root, 'gallery.js');
  await fs.copyFile(path.join(__dirname, 'gallery.js'), script);
  const standalone = require(script);
  const server = await standalone.createGallery(root, { cacheDir, ffmpeg: null });
  assert.equal(server.thumbnailsEnabled, false);
  await assert.rejects(fs.stat(cacheDir), { code: 'ENOENT' });
});

test('real Sharp creates small WebP previews with correct orientation and transparency', { skip: !sharp && 'Set FOLDER_GALLERY_TEST_SHARP=1 with Sharp installed' }, async t => {
  const root = await fixture(t), cache = await fixture(t);
  await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#c04020' } })
    .jpeg().withMetadata({ orientation: 6 }).toFile(path.join(root, 'rotated.jpg'));
  await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 10, g: 30, b: 50, alpha: 0.5 } } })
    .png().toFile(path.join(root, 'transparent.png'));
  await fs.writeFile(path.join(root, 'unsupported.bmp'), 'not-an-image');
  const before = await fs.readFile(path.join(root, 'rotated.jpg'));
  const base = await serve(t, root, { cacheDir: path.join(cache, 'previews') });
  assert.equal((await (await fetch(base + '/api/albums')).json()).thumbnails, true);
  const response = await fetch(base + '/media/rotated.jpg?thumbnail=1');
  const output = Buffer.from(await response.arrayBuffer()), metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 320); assert.equal(metadata.height, 640);
  assert.ok(output.length < before.length);
  const transparent = await fetch(base + '/media/transparent.png?thumbnail=1');
  const alpha = await sharp(Buffer.from(await transparent.arrayBuffer())).metadata();
  assert.equal(alpha.width, 80); assert.equal(alpha.height, 40); assert.equal(alpha.hasAlpha, true);
  assert.deepEqual(await fs.readFile(path.join(root, 'rotated.jpg')), before);
  assert.equal(await (await fetch(base + '/media/unsupported.bmp?thumbnail=1')).text(), 'not-an-image');
});
