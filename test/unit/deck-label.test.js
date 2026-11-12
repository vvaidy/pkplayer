import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckLabel } from '../../src/lib/deck-label.js';

test('with no presenter or title the label is the file name line, exactly as before', () => {
  assert.deepEqual(deckLabel({ name: 'bravo-25-slides.pdf', presenter: '', title: '' }, 0, 2, 4), {
    presenter: '',
    title: '',
    meta: 'PDF 1 of 2 · bravo-25-slides.pdf · 4 slides',
  });
  // Items saved by an older version have no presenter/title fields at all.
  assert.equal(deckLabel({ name: 'a.pdf' }, 2, 3, 1).meta, 'PDF 3 of 3 · a.pdf · 1 slide');
});

test('presenter and title replace the file name', () => {
  assert.deepEqual(deckLabel({ name: 'a.pdf', presenter: 'Asha Rao', title: 'Tiny Gardens' }, 0, 4, 20), {
    presenter: 'Asha Rao',
    title: 'Tiny Gardens',
    meta: 'PDF 1 of 4 · 20 slides',
  });
});

test('either one alone is enough to drop the file name', () => {
  assert.deepEqual(deckLabel({ name: 'a.pdf', presenter: 'Asha', title: '' }, 0, 1, 20), {
    presenter: 'Asha', title: '', meta: 'PDF 1 of 1 · 20 slides',
  });
  assert.deepEqual(deckLabel({ name: 'a.pdf', presenter: '', title: 'Tiny Gardens' }, 0, 1, 20), {
    presenter: '', title: 'Tiny Gardens', meta: 'PDF 1 of 1 · 20 slides',
  });
});

test('blank or odd values count as not set, and nothing throws', () => {
  assert.equal(deckLabel({ name: 'a.pdf', presenter: '   ', title: 7 }, 0, 1, 2).meta, 'PDF 1 of 1 · a.pdf · 2 slides');
  assert.equal(deckLabel({}, 0, 1, 0).meta, 'PDF 1 of 1 · Untitled.pdf · 0 slides');
  assert.equal(deckLabel(undefined, 0, 1, 3).meta, 'PDF 1 of 1 · Untitled.pdf · 3 slides');
});

// ---------- defaults from PDF properties ----------
const { suggestFromMetadata } = await import('../../src/lib/deck-label.js');

test('a real title and author become the defaults', () => {
  assert.deepEqual(suggestFromMetadata({ title: 'Tiny Gardens', author: 'Asha Rao' }, '1-tiny-gardens.pdf'), {
    presenter: 'Asha Rao',
    title: 'Tiny Gardens',
  });
  assert.deepEqual(suggestFromMetadata({ title: '  Why   Bread\nRises ', author: 'Lena' }, 'x.pdf'), {
    presenter: 'Lena',
    title: 'Why Bread Rises',
  });
});

test('placeholder and file-name titles are dropped', () => {
  for (const title of ['PowerPoint Presentation', 'Presentation1', 'presentation 12', 'Slide 1', 'Untitled', 'untitled presentation',
    'No Slide Title', 'Document3', 'talk-final-v3.pptx', 'Microsoft PowerPoint - talk.pptx', 'my deck.key']) {
    assert.equal(suggestFromMetadata({ title }, 'other.pdf').title, '', title);
  }
  assert.equal(suggestFromMetadata({ title: 'Night Trains' }, 'night-trains.pdf').title, '');
  assert.equal(suggestFromMetadata({ title: 'night_trains' }, 'Night Trains.pdf').title, '');
  assert.equal(suggestFromMetadata({ title: 'Microsoft PowerPoint - Night Trains' }, 'deck.pdf').title, 'Night Trains');
});

test('generic, account-like and e-mail authors are dropped', () => {
  for (const author of ['Microsoft Office User', 'Windows User', 'user', 'Admin', 'owner', 'student', 'vvaidy', 'j.smith42',
    'someone@example.com', '12345', '---']) {
    assert.equal(suggestFromMetadata({ author }, 'a.pdf').presenter, '', author);
  }
  assert.equal(suggestFromMetadata({ author: 'Marek' }, 'a.pdf').presenter, 'Marek');
  assert.equal(suggestFromMetadata({ author: 'Zoë Müller' }, 'a.pdf').presenter, 'Zoë Müller');
  assert.equal(suggestFromMetadata({ author: '田中 太郎' }, 'a.pdf').presenter, '田中 太郎');
});

test('missing or odd metadata gives empty defaults and never throws', () => {
  const empty = { presenter: '', title: '' };
  for (const meta of [null, undefined, {}, { title: 5, author: {} }, { title: '', author: '   ' }]) {
    assert.deepEqual(suggestFromMetadata(meta, 'a.pdf'), empty);
  }
  assert.deepEqual(suggestFromMetadata({ title: 'T', author: 'Asha' }), { presenter: 'Asha', title: 'T' });
  assert.equal(suggestFromMetadata({ title: 'x'.repeat(500) }, 'a.pdf').title.length, 200);
});
