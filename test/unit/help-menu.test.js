import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP_LINKS, REPO_URL, buildHelpMenu, openHelpLink } from '../../src/main/help-menu.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const links = HELP_LINKS.filter((l) => l.type !== 'separator');

function headingSlugs(markdown) {
  return new Set(
    [...markdown.matchAll(/^#+ (.+)$/gm)].map((m) =>
      m[1].trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-'),
    ),
  );
}

test('help menu has a click item per link, in order, with separators kept', () => {
  const menu = buildHelpMenu(() => {});
  assert.equal(menu.role, 'help');
  assert.equal(menu.submenu.length, HELP_LINKS.length);
  menu.submenu.forEach((item, i) => {
    if (HELP_LINKS[i].type === 'separator') assert.equal(item.type, 'separator');
    else {
      assert.equal(item.label, HELP_LINKS[i].label);
      assert.equal(typeof item.click, 'function');
    }
  });
  assert.ok(links.some((l) => l.label === 'PK Player Manual'));
});

test('every link points into the project repo over https', () => {
  for (const l of links) {
    assert.ok(l.url === REPO_URL || l.url.startsWith(`${REPO_URL}/`), l.url);
    assert.ok(l.url.startsWith('https://'), l.url);
  }
});

test('every manual link points at a file (and heading) that exists in the repo', () => {
  for (const l of links.filter((x) => x.doc)) {
    const file = path.join(ROOT, l.doc);
    assert.ok(fs.existsSync(file), `missing ${l.doc} for "${l.label}"`);
    assert.ok(l.url.endsWith(l.doc) || l.url.includes(`${l.doc.split('/').pop()}#`), `${l.url} vs ${l.doc}`);
    if (l.anchor) {
      assert.ok(headingSlugs(fs.readFileSync(file, 'utf-8')).has(l.anchor), `no #${l.anchor} in ${l.doc}`);
      assert.ok(l.url.endsWith(`#${l.anchor}`));
    }
  }
});

test('clicking a menu item opens its URL', async () => {
  const opened = [];
  const menu = buildHelpMenu(async (url) => opened.push(url));
  const idx = HELP_LINKS.findIndex((l) => l.label === 'Download the Latest Version');
  await menu.submenu[idx].click();
  assert.deepEqual(opened, [`${REPO_URL}/releases/latest`]);
});

test('openHelpLink refuses other sites and never throws', async () => {
  const opened = [];
  const open = async (url) => opened.push(url);
  const origError = console.error;
  console.error = () => {}; // expected error logs
  try {
    assert.equal(await openHelpLink('https://evil.example.com', open), false);
    assert.equal(await openHelpLink(`${REPO_URL}evil`, open), false);
    assert.equal(await openHelpLink(undefined, open), false);
    assert.equal(await openHelpLink(REPO_URL, async () => { throw new Error('no browser'); }), false);
  } finally {
    console.error = origError;
  }
  assert.deepEqual(opened, []);
  assert.equal(await openHelpLink(`${REPO_URL}/releases/latest`, open), true);
  assert.deepEqual(opened, [`${REPO_URL}/releases/latest`]);
});
