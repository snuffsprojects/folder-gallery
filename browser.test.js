'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGallery } = require('./gallery');
const enabled = Boolean(process.env.FOLDER_GALLERY_TEST_BROWSER);

test('mixed folders expose their direct images and jump controls on desktop and mobile', {
  skip: !enabled && 'Set FOLDER_GALLERY_TEST_BROWSER=1 with Playwright, Chromium and Sharp installed', timeout: 60000
}, async t => {
  const { chromium } = require('playwright');
  const sharp = require('sharp');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-gallery-browser-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#d06030' } }).jpeg().toBuffer();
  for (let i = 1; i <= 16; i++) {
    const folder = path.join(root, 'Mixed', `Child ${i}`);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'nested.jpg'), image);
  }
  await fs.writeFile(path.join(root, 'loose.jpg'), image);
  for (let i = 1; i <= 40; i++) await fs.writeFile(path.join(root, 'Mixed', `direct${i}.jpg`), image);
  const server = await createGallery(root, { thumbnails: false });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('#jump-root-files').click();
      await page.locator('#root-photos .photo-tile').click();
      assert.equal(await page.locator('#photo').getAttribute('src'), '/media/loose.jpg');
      await page.locator('#close-image').click();
      await page.locator('#albums .album').filter({ hasText: 'Mixed' }).click();
      await page.waitForFunction(() => document.querySelector('#jump-folder-files').textContent === 'Files in this folder (40) ↓');
      assert.equal(await page.locator('#folder-children .album').count(), 16);
      assert.equal(await page.locator('#photos .photo-tile').count(), 30);
      assert.equal(await page.locator('#folder-files-title').textContent(), 'Files in this folder (40)');
      await page.locator('#jump-folder-files').click();
      await page.waitForFunction(() => {
        const photo = document.querySelector('#photos .photo-tile').getBoundingClientRect();
        const bar = document.querySelector('.viewer-bar').getBoundingClientRect();
        return photo.bottom > bar.bottom && photo.top < window.innerHeight;
      });
      await page.locator('#photos .photo-tile').first().click();
      await page.waitForFunction(() => document.querySelector('#photo').naturalWidth === 1200);
      assert.equal(await page.locator('#photo').getAttribute('src'), '/media/Mixed/direct1.jpg');
      await page.locator('#close-image').click();
      await page.locator('#viewer .pagination').first().getByRole('button', { name: 'Next →', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#photos .photo-tile').length === 10);
      assert.equal(await page.locator('#photos img').first().getAttribute('src'), '/media/Mixed/direct31.jpg');
      await page.locator('#jump-subfolders').click();
      await page.waitForFunction(() => document.querySelector('#folder-children').getBoundingClientRect().top < window.innerHeight);
      await page.locator('#folder-children .album').filter({ has: page.locator('strong').filter({ hasText: /^Child 1$/ }) }).click();
      await page.waitForFunction(() => document.querySelector('#album-title').textContent === 'Child 1' && document.querySelector('#photos img')?.getAttribute('src') === '/media/Mixed/Child%201/nested.jpg');
      await page.locator('#close-album').click();
      await page.waitForFunction(() => document.querySelector('#jump-folder-files').textContent === 'Files in this folder (40) ↓' && !document.querySelector('#jump-folder-files').disabled);
      await page.locator('#jump-folder-files').click();
      assert.equal(await page.locator('#photos .photo-tile').count(), 30);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});
