'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { scanFolders, createGallery, HTML } = require('./gallery');

async function collection(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-gallery-tree-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ['Holidays/Winter', 'Holidays/Empty', 'Archive/Winter', 'Empty', 'A # % café/Child']) {
    await fs.mkdir(path.join(root, folder), { recursive: true });
  }
  for (let i = 1; i <= 65; i++) await fs.writeFile(path.join(root, `root${i}.jpg`), 'root');
  await fs.writeFile(path.join(root, 'Holidays/Winter/snow.png'), 'snow-image');
  await fs.writeFile(path.join(root, 'Archive/Winter/old.jpg'), 'old');
  await fs.writeFile(path.join(root, 'A # % café/Child/clip.webm'), 'video');
  const server = await createGallery(root, { thumbnails: false });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { root, base: `http://127.0.0.1:${server.address().port}` };
}

test('folder API preserves every level, direct files, empty folders, recursive totals and refresh', async t => {
  const { root, base } = await collection(t);
  const get = async route => (await fetch(base + route)).json();
  const { folders } = await scanFolders(root);
  assert.equal(folders.get('Holidays').count, 0);
  assert.equal(folders.get('Holidays/Winter').parentId, 'Holidays');
  assert.equal(folders.get('Empty').parentId, '.');
  const all = await get('/api/albums');
  assert.equal(all.rootAlbum.count, 65); assert.equal(all.rootAlbum.totalCount, 68);
  assert.equal(all.totalImages, 68);
  assert.ok(all.folders.every(folder => !('images' in folder) && !('children' in folder)));
  assert.equal(all.folders.find(folder => folder.id === 'Holidays').count, 1);
  assert.equal(all.folders.find(folder => folder.id === 'Holidays').directCount, 0);
  assert.equal(all.folders.find(folder => folder.id === 'Holidays').cover, '/media/Holidays/Winter/snow.png');
  const home = await get('/api/gallery?id=.');
  assert.deepEqual(home.children.map(folder => folder.id), ['A # % café', 'Archive', 'Empty', 'Holidays']);
  assert.equal(home.images.length, 30); assert.equal(home.pages, 3);
  assert.ok(home.images.every(image => /^root\d+\.jpg$/.test(image.name)));
  const parent = await get('/api/gallery?id=Holidays');
  assert.equal(parent.count, 0); assert.equal(parent.pages, 1); assert.deepEqual(parent.images, []);
  assert.deepEqual(parent.children.map(folder => folder.id), ['Holidays/Empty', 'Holidays/Winter']);
  const child = await get('/api/gallery?id=Holidays%2FWinter');
  assert.equal(child.parentId, 'Holidays'); assert.equal(child.images[0].name, 'snow.png'); assert.deepEqual(child.children, []);
  assert.equal((await get('/api/gallery?id=Empty')).count, 0);
  assert.equal((await fetch(base + '/api/gallery?id=Empty&page=2')).status, 400);
  const filtered = await get('/api/gallery?id=.&types=jpg&sort=size-desc');
  assert.deepEqual(filtered.children.map(folder => folder.id), ['Archive', 'A # % café', 'Empty', 'Holidays']);
  assert.equal(filtered.children.find(folder => folder.id === 'Holidays').count, 0);
  assert.equal((await get('/api/gallery?id=Holidays&types=jpg')).children.length, 2);
  assert.equal((await get('/api/gallery?id=Holidays%2FWinter&types=jpg')).count, 0);
  const special = await get('/api/gallery?id=' + encodeURIComponent('A # % café'));
  assert.equal(special.children[0].id, 'A # % café/Child');
  await fs.rename(path.join(root, 'Holidays'), path.join(root, 'Trips'));
  await get('/api/albums?refresh=1');
  assert.equal((await fetch(base + '/api/gallery?id=Holidays')).status, 404);
  assert.equal((await get('/api/gallery?id=Trips%2FWinter')).parentId, 'Trips');
  assert.ok(!(await get('/api/gallery?id=.')).children.some(folder => folder.id === 'Holidays'));
  assert.equal((await fetch(base + '/api/gallery?id=..%2Foutside')).status, 404);
});

test('browser shows immediate children, root files, breadcrumbs, Back and global search', async t => {
  const { base } = await collection(t);
  const elements = new Map(), pending = new Set();
  function element(tag = 'div') {
    return {
      tagName: tag, value: '', children: [], handlers: {}, hidden: false, open: false, scrollTop: 0, offsetTop: 0, style: {},
      classList: { toggle() {}, add() {} },
      setAttribute(key, value) { this[key] = value; }, getAttribute(key) { return this[key] ?? null; }, removeAttribute(key) { delete this[key]; },
      append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); },
      replaceChildren(...items) { this.children = items; }, replaceWith() {}, remove() {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      showModal() { assert.equal(this.open, false, 'Do not reopen an already open dialog'); this.open = true; },
      close() { if (this.open) { this.open = false; this.handlers.close?.(); } },
      pause() {}, load() {}, scrollTo({ top }) { this.scrollTop = top; }
    };
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const viewerControls = [element('nav'), element('nav')], rootControls = [element('nav'), element('nav')];
  const document = {
    querySelector: $, querySelectorAll: selector => selector === '.root-pagination' ? rootControls : viewerControls,
    createElement: element, addEventListener(type, handler) { this[type] = handler; }
  };
  let holdFolder = null, release;
  const context = vm.createContext({
    document, window: { scrollY: 0, scrollTo() {}, addEventListener() {} }, matchMedia: () => ({ matches: false }),
    fetch: url => {
      const task = (async () => {
        if (holdFolder && url.startsWith('/api/gallery?id=' + holdFolder + '&')) {
          holdFolder = null; await new Promise(resolve => { release = resolve; });
        }
        const response = await fetch(base + url), data = await response.json();
        return { ok: response.ok, json: async () => data };
      })();
      pending.add(task); task.finally(() => pending.delete(task)); return task;
    }
  });
  async function settle() {
    do { await Promise.all([...pending]); await new Promise(resolve => setImmediate(resolve)); } while (pending.size);
  }
  const card = (selector, name) => $(selector).children.find(button => button.children[1].children[0].textContent === name);
  vm.runInContext(HTML.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await settle();
  assert.equal($('#albums').children.length, 4);
  assert.equal(card('#albums', 'Winter'), undefined);
  assert.equal($('#root-photos').children.length, 30);
  assert.equal($('#root-files').hidden, false);
  rootControls[1].children[2].handlers.click(); await settle();
  $('#root-photos').children[29].handlers.click(); await settle();
  assert.equal($('#photo').src, '/media/root60.jpg');
  assert.equal($('#viewer').open, false); assert.equal($('#lightbox').open, true);
  $('#next-image').handlers.click(); await settle();
  assert.equal($('#photo').src, '/media/root61.jpg'); assert.equal($('#root-photos').children.length, 5);
  $('#close-image').handlers.click();
  card('#albums', 'Holidays').handlers.click(); await settle();
  assert.equal($('#album-title').textContent, 'Holidays'); assert.equal($('#photos').children.length, 0);
  assert.equal($('#folder-children').children.length, 2);
  assert.equal($('#folder-breadcrumbs').children[0].textContent, 'Home');
  card('#folder-children', 'Winter').handlers.click(); await settle();
  assert.equal($('#album-title').textContent, 'Winter'); assert.equal($('#photos').children.length, 1);
  assert.equal($('#folder-breadcrumbs').children.map(child => child.textContent).join(' '), 'Home › Holidays › Winter');
  $('#photos').children[0].handlers.click(); await settle();
  assert.equal($('#photo').src, '/media/Holidays/Winter/snow.png');
  $('#close-image').handlers.click();
  $('#close-album').handlers.click(); await settle();
  assert.equal($('#album-title').textContent, 'Holidays'); assert.equal($('#viewer').open, true);
  card('#folder-children', 'Empty').handlers.click(); await settle();
  assert.equal($('#viewer-empty').hidden, false); assert.equal($('#photos').children.length, 0);
  $('#folder-breadcrumbs').children[2].handlers.click(); await settle();
  assert.equal($('#album-title').textContent, 'Holidays');
  $('#folder-breadcrumbs').children[0].handlers.click(); await settle();
  assert.equal($('#viewer').open, false); assert.equal($('#root-photos').children.length, 30);
  $('#search').value = 'winter'; $('#search').handlers.input();
  assert.equal($('#albums').children.length, 2); assert.equal($('#root-files').hidden, true);
  const paths = $('#albums').children.map(button => button.children[1].children[2].textContent).sort();
  assert.deepEqual(paths, ['Archive/Winter', 'Holidays/Winter']);
  $('#albums').children[0].handlers.click(); await settle();
  assert.equal($('#search').value, ''); assert.equal($('#album-folder').textContent, 'Archive/Winter');
  $('#close-album').handlers.click(); await settle();
  assert.equal($('#album-title').textContent, 'Archive');
  $('#viewer-sort-order').handlers.change({ target: { value: 'size-desc' } }); await settle();
  assert.equal($('#album-title').textContent, 'Archive'); assert.equal($('#sort-order').value, 'size-desc');
  $('#close-album').handlers.click(); await settle();
  $('#type-filters').children[8].handlers.click(); await settle();
  assert.equal($('#albums').children.length, 4); assert.equal($('#root-files').hidden, true);
  card('#albums', 'Holidays').handlers.click(); await settle();
  assert.equal($('#folder-children').children.length, 2);
  $('#folder-breadcrumbs').children[0].handlers.click(); await settle();
  // An old folder response must not replace a newer navigation target.
  holdFolder = 'Holidays'; card('#albums', 'Holidays').handlers.click();
  $('#folder-breadcrumbs').children[0].handlers.click();
  card('#albums', 'Archive').handlers.click();
  release(); await settle();
  assert.equal($('#album-title').textContent, 'Archive');
  assert.equal($('#folder-children').children.length, 1);
});
