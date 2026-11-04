'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const { createGallery, createThumbnailCache, findFFmpeg, extractVideoFrame } = require('./gallery');
const realFFmpeg = Boolean(process.env.FOLDER_GALLERY_TEST_FFMPEG);

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-gallery-video-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function serve(t, root, options) {
  const server = await createGallery(root, { sharp: null, ...options });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('video thumbnails share bounded cache processing and invalidate when the clip changes', async t => {
  const dir = await fixture(t), file = path.join(dir, 'clip.webm');
  await fs.writeFile(file, 'video');
  let calls = 0;
  const thumbnail = createThumbnailCache(null, {
    cacheDir: path.join(dir, 'cache'),
    videoRenderer: async name => { assert.equal(name, file); calls++; return Buffer.from('webp-frame'); }
  });
  const stat = await fs.stat(file);
  const [first, second] = await Promise.all([thumbnail(file, stat), thumbnail(file, stat)]);
  assert.deepEqual(first, second); assert.equal(calls, 1);
  assert.deepEqual(await thumbnail(file, stat), first); assert.equal(calls, 1);
  await fs.writeFile(file, 'new-video');
  assert.notEqual((await thumbnail(file, await fs.stat(file))).etag, first.etag);
  assert.equal(calls, 2);
});

test('unavailable or disabled video processing preserves playback and never serves video as a preview', async t => {
  const root = await fixture(t), cache = await fixture(t);
  await fs.writeFile(path.join(root, 'clip.webm'), '0123456789');
  for (const options of [
    { ffmpeg: null },
    { ffmpeg: '/missing/ffmpeg', videoThumbnails: false },
    { ffmpeg: '/missing/ffmpeg', thumbnails: false },
    { ffmpeg: path.join(cache, 'does-not-exist') }
  ]) {
    const cacheDir = path.join(cache, 'unused');
    const base = await serve(t, root, { ...options, cacheDir });
    const preview = await fetch(base + '/media/clip.webm?thumbnail=1');
    assert.equal(preview.status, 404); assert.equal(preview.headers.get('content-type'), 'application/json; charset=utf-8');
    const video = await fetch(base + '/media/clip.webm', { headers: { Range: 'bytes=2-5' } });
    assert.equal(video.status, 206); assert.equal(await video.text(), '2345');
    const download = await fetch(base + '/media/clip.webm?thumbnail=1&download=1');
    assert.equal(download.headers.get('content-type'), 'video/webm'); assert.equal(await download.text(), '0123456789');
    if (!options.ffmpeg || options.videoThumbnails === false || options.thumbnails === false) {
      assert.equal((await (await fetch(base + '/api/albums')).json()).videoThumbnails, false);
      await assert.rejects(fs.stat(cacheDir), { code: 'ENOENT' });
    }
  }
});

test('real FFmpeg previews work without Sharp, handle short clips, cache frames and preserve playback', {
  skip: !realFFmpeg && 'Set FOLDER_GALLERY_TEST_FFMPEG=1 with FFmpeg installed'
}, async t => {
  assert.equal(await findFFmpeg(), 'ffmpeg');
  const root = await fixture(t), cache = await fixture(t);
  const special = "clip # café $(never-execute).webm";
  for (const [filename, duration] of [[special, '2'], ['short.webm', '0.1']]) {
    await execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=10',
      '-t', duration, '-c:v', 'libvpx', '-threads', '1', '-deadline', 'realtime', '-cpu-used', '8', path.join(root, filename)
    ], { timeout: 15000, windowsHide: true });
  }
  await fs.writeFile(path.join(root, 'broken.webm'), 'not-a-video');
  const before = await fs.readFile(path.join(root, special));
  const base = await serve(t, root, { cacheDir: path.join(cache, 'previews') });
  const albums = await (await fetch(base + '/api/albums')).json();
  assert.equal(albums.thumbnails, false); assert.equal(albums.videoThumbnails, true);
  await assert.rejects(fs.stat(path.join(cache, 'previews')), { code: 'ENOENT' });
  const url = base + '/media/' + encodeURIComponent(special);
  const preview = await fetch(url + '?thumbnail=1');
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'image/webp');
  const buffer = Buffer.from(await preview.arrayBuffer());
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF'); assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  const short = await fetch(base + '/media/short.webm?thumbnail=1');
  assert.equal(short.status, 200); assert.ok((await short.arrayBuffer()).byteLength > 0);
  const names = await fs.readdir(path.join(cache, 'previews'));
  assert.equal(names.length, 2);
  const { stdout } = await execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', path.join(cache, 'previews', names[0])]);
  const metadata = JSON.parse(stdout).streams[0];
  assert.equal(metadata.width, 640); assert.equal(metadata.height, 360);
  const head = await fetch(url + '?thumbnail=1', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(buffer.length)); assert.equal(await head.text(), '');
  const cached = await fetch(url + '?thumbnail=1', { headers: { 'If-None-Match': preview.headers.get('etag') } });
  assert.equal(cached.status, 304);
  const ranged = await fetch(url, { headers: { Range: 'bytes=0-9' } });
  assert.equal(ranged.status, 206); assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), before.subarray(0, 10));
  assert.equal((await fetch(base + '/media/broken.webm?thumbnail=1')).status, 404);
  await fs.writeFile(path.join(root, '.hidden.webm'), before);
  await fs.writeFile(path.join(cache, 'outside.webm'), before);
  await fs.symlink(path.join(cache, 'outside.webm'), path.join(root, 'escape.webm'));
  for (const name of ['.hidden.webm', 'escape.webm', '../outside.webm']) {
    assert.equal((await fetch(base + '/media/' + encodeURIComponent(name) + '?thumbnail=1')).status, 404);
  }
  const blocked = await serve(t, root, { cacheDir: path.join(root, 'short.webm') });
  assert.equal((await fetch(blocked + '/media/short.webm?thumbnail=1')).status, 404);
  assert.deepEqual(await fs.readFile(path.join(root, special)), before);
  const originalStat = await fs.stat(path.join(root, special));
  await fs.utimes(path.join(root, special), originalStat.atime, new Date(originalStat.mtimeMs + 2000));
  const changed = await fetch(url + '?thumbnail=1', { headers: { 'If-None-Match': preview.headers.get('etag') } });
  assert.equal(changed.status, 200); assert.notEqual(changed.headers.get('etag'), preview.headers.get('etag'));
  await assert.rejects(extractVideoFrame(path.join(root, 'broken.webm')));
});
