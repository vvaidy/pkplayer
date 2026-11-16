// Persistent storage for Events, their playlists and app settings.
// Data lives in <dataDir>/events.json; imported PDFs are copied to <dataDir>/library/
// so events keep working if the originals are moved or deleted.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { debug } from '../lib/debug.js';
import { DEFAULT_MAX_SLIDES, DEFAULT_TIME_PER_SLIDE } from '../lib/player-controller.js';
import { parsePageNumber } from '../lib/page-range.js';
import { CUSTOM_THEME_PREFIX, DEFAULT_THEME_ID, THEMES, isThemeId, normalizeTheme, themeById } from '../lib/themes.js';

export const SCHEMA_VERSION = 1;
/** Id of the one-deck event that Practice plays. It is never listed and never saved. */
export const PRACTICE_EVENT_ID = 'practice';
const PRACTICE_FILE_PREFIX = 'practice-';
export const LIMITS = Object.freeze({
  timePerSlide: { min: 0.5, max: 3600 },
  maxSlides: { min: 1, max: 999 },
  nameLength: 200,
  customThemes: 100,
});

export class StoreError extends Error {}

const newId = () => crypto.randomUUID();

function emptyData() {
  return {
    version: SCHEMA_VERSION,
    // checkUpdates: look for a newer version once a day. lastUpdateCheck: when that last ran (ISO date) or null.
    settings: { displayId: null, theme: DEFAULT_THEME_ID, checkUpdates: true, lastUpdateCheck: null },
    themes: [],
    events: [],
  };
}

function clampNumber(value, { min, max }, label, { integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new StoreError(`${label} must be a number (got "${value}")`);
  if (integer && !Number.isInteger(n)) throw new StoreError(`${label} must be a whole number (got ${n})`);
  if (n < min || n > max) throw new StoreError(`${label} must be between ${min} and ${max} (got ${n})`);
  return n;
}

/** Optional one-line text (presenter, talk title): trimmed, capped, "" when absent. */
function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameLength) : '';
}

/** A stored first/last page: a valid page number, or null when missing or damaged. Never throws. */
function storedPage(value) {
  try {
    return parsePageNumber(value);
  } catch {
    return null;
  }
}

function cleanName(name, fallback) {
  const s = String(name ?? '').trim().slice(0, LIMITS.nameLength);
  return s || fallback;
}

/** Check the file starts with the PDF magic bytes. */
export function isPdfFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024);
    const n = fs.readSync(fd, buf, 0, 1024, 0);
    return buf.subarray(0, n).includes('%PDF-');
  } catch (err) {
    debug('store', `cannot read ${filePath}`, err);
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.libraryDir = path.join(dataDir, 'library');
    this.file = path.join(dataDir, 'events.json');
    fs.mkdirSync(this.libraryDir, { recursive: true });
    this.data = this.#load();
    this.practice = null;
    this.#removePracticeFiles(); // left behind if the app was closed mid-practice
  }

  // ---------- persistence ----------

  #load() {
    if (!fs.existsSync(this.file)) return emptyData();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, { encoding: 'utf-8' }));
      const data = emptyData();
      data.settings = { ...data.settings, ...(raw.settings || {}) };
      data.settings.checkUpdates = data.settings.checkUpdates !== false;
      if (typeof data.settings.lastUpdateCheck !== 'string' || Number.isNaN(Date.parse(data.settings.lastUpdateCheck))) {
        data.settings.lastUpdateCheck = null;
      }
      // Custom themes: keep the valid ones, quietly drop anything damaged.
      for (const item of Array.isArray(raw.themes) ? raw.themes : []) {
        try {
          const t = normalizeTheme(item);
          if (t.id && !data.themes.some((x) => x.id === t.id)) data.themes.push(t);
        } catch (err) {
          debug('store', 'dropped an unreadable custom theme', err);
        }
      }
      // Files from before themes existed have no theme; an unknown id (a theme removed later) also falls back.
      if (!isThemeId(data.settings.theme) && !data.themes.some((t) => t.id === data.settings.theme)) {
        data.settings.theme = DEFAULT_THEME_ID;
      }
      data.events = (Array.isArray(raw.events) ? raw.events : []).map((e) => ({
        id: String(e.id || newId()),
        name: cleanName(e.name, 'Untitled Event'),
        timePerSlide: Number(e.timePerSlide) > 0 ? Number(e.timePerSlide) : DEFAULT_TIME_PER_SLIDE,
        maxSlides: Number.isInteger(e.maxSlides) && e.maxSlides >= 1 ? e.maxSlides : DEFAULT_MAX_SLIDES,
        showProgress: e.showProgress !== false, // on unless switched off; absent in files written before 1.4
        items: (Array.isArray(e.items) ? e.items : [])
          .filter((it) => it && it.file)
          .map((it) => ({
            id: String(it.id || newId()),
            name: cleanName(it.name, 'Untitled.pdf'),
            file: path.basename(String(it.file)),
            pageCount: Number.isInteger(it.pageCount) ? it.pageCount : null,
            presenter: cleanText(it.presenter), // absent in files written before 1.1
            title: cleanText(it.title),
            firstPage: storedPage(it.firstPage), // null = from page 1; absent in files written before 1.3
            lastPage: storedPage(it.lastPage), // null = to the end
            // Set once a deck's pages have been edited: the copy as it was added, kept so it can be restored.
            originalFile: it.originalFile ? path.basename(String(it.originalFile)) : null,
          })),
        createdAt: e.createdAt || new Date().toISOString(),
      }));
      debug('store', `loaded ${data.events.length} events from ${this.file}`);
      return data;
    } catch (err) {
      // Never lose the user's data silently: keep the broken file aside and start fresh.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      debug('store', `events.json unreadable, moved to ${backup}`, err);
      try {
        fs.renameSync(this.file, backup);
      } catch (e2) {
        debug('store', 'could not back up corrupt events.json', e2);
      }
      return emptyData();
    }
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf-8' });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      debug('store', 'failed to save events.json', err);
      throw new StoreError(`Could not save events: ${err.message}`);
    }
  }

  /** Look up an event. The practice deck is only visible to the few callers that ask for it. */
  #event(id, { allowPractice = false } = {}) {
    if (allowPractice && id === PRACTICE_EVENT_ID && this.practice) return this.practice;
    const ev = this.data.events.find((e) => e.id === id);
    if (!ev) throw new StoreError(`Event not found: ${id}`);
    return ev;
  }

  #clone(v) {
    return structuredClone(v);
  }

  libraryPath(file) {
    return path.join(this.libraryDir, path.basename(file));
  }

  // ---------- events ----------

  listEvents() {
    return this.#clone(this.data.events);
  }

  getEvent(id) {
    return this.#clone(this.#event(id, { allowPractice: true }));
  }

  createEvent(name) {
    const ev = {
      id: newId(),
      name: cleanName(name, `Event ${this.data.events.length + 1}`),
      timePerSlide: DEFAULT_TIME_PER_SLIDE,
      maxSlides: DEFAULT_MAX_SLIDES,
      showProgress: true,
      items: [],
      createdAt: new Date().toISOString(),
    };
    this.data.events.push(ev);
    this.#save();
    debug('store', `created event ${ev.id} "${ev.name}"`);
    return this.#clone(ev);
  }

  updateEvent(id, patch = {}) {
    const ev = this.#event(id);
    if ('name' in patch) ev.name = cleanName(patch.name, ev.name);
    if ('timePerSlide' in patch) ev.timePerSlide = clampNumber(patch.timePerSlide, LIMITS.timePerSlide, 'Time per slide');
    if ('maxSlides' in patch) {
      ev.maxSlides = clampNumber(patch.maxSlides, LIMITS.maxSlides, 'Max slides', { integer: true });
    }
    if ('showProgress' in patch) {
      if (typeof patch.showProgress !== 'boolean') throw new StoreError('The progress bar setting must be on or off');
      ev.showProgress = patch.showProgress;
    }
    this.#save();
    return this.#clone(ev);
  }

  deleteEvent(id) {
    const idx = this.data.events.findIndex((e) => e.id === id);
    if (idx < 0) throw new StoreError(`Event not found: ${id}`);
    this.data.events.splice(idx, 1);
    this.#save();
    this.gcLibrary();
    return true;
  }

  duplicateEvent(id) {
    const src = this.#event(id);
    const copy = {
      ...this.#clone(src),
      id: newId(),
      name: cleanName(`${src.name} copy`, 'Event copy'),
      createdAt: new Date().toISOString(),
    };
    // Library files are shared between events; gcLibrary() keeps them while referenced.
    copy.items = copy.items.map((it) => ({ ...it, id: newId() }));
    const idx = this.data.events.findIndex((e) => e.id === id);
    this.data.events.splice(idx + 1, 0, copy);
    this.#save();
    return this.#clone(copy);
  }

  // ---------- playlist ----------

  /**
   * Copy PDFs into the library and insert them into the event's playlist.
   * @returns {{ added: object[], rejected: {path:string, reason:string}[] }}
   */
  addPdfs(eventId, filePaths, index) {
    const ev = this.#event(eventId);
    const added = [];
    const rejected = [];
    for (const p of filePaths || []) {
      try {
        if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
          rejected.push({ path: p, reason: 'File not found' });
          continue;
        }
        if (!isPdfFile(p)) {
          rejected.push({ path: p, reason: 'Not a PDF file' });
          continue;
        }
        const id = newId();
        const file = `${id}.pdf`;
        fs.copyFileSync(p, this.libraryPath(file));
        added.push({ id, name: cleanName(path.basename(p), 'Untitled.pdf'), file, pageCount: null, presenter: '', title: '', firstPage: null, lastPage: null, originalFile: null });
        debug('store', `imported ${p} -> ${file}`);
      } catch (err) {
        debug('store', `failed to import ${p}`, err);
        rejected.push({ path: p, reason: err.message });
      }
    }
    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, ev.items.length)) : ev.items.length;
    ev.items.splice(at, 0, ...added);
    if (added.length) this.#save();
    return { added: this.#clone(added), rejected };
  }

  removeItem(eventId, itemId) {
    const ev = this.#event(eventId);
    const idx = ev.items.findIndex((it) => it.id === itemId);
    if (idx < 0) throw new StoreError(`Playlist item not found: ${itemId}`);
    ev.items.splice(idx, 1);
    this.#save();
    this.gcLibrary();
    return this.#clone(ev);
  }

  /** Replace the playlist order. `orderedIds` must be a permutation of the current item ids. */
  reorderItems(eventId, orderedIds) {
    const ev = this.#event(eventId);
    const byId = new Map(ev.items.map((it) => [it.id, it]));
    const unique = new Set(orderedIds);
    if (!Array.isArray(orderedIds) || orderedIds.length !== ev.items.length || unique.size !== ev.items.length
      || orderedIds.some((id) => !byId.has(id))) {
      throw new StoreError('Reorder list does not match the playlist');
    }
    ev.items = orderedIds.map((id) => byId.get(id));
    this.#save();
    return this.#clone(ev);
  }

  /** Move one item to a new index (convenience for keyboard reordering). */
  moveItem(eventId, itemId, toIndex) {
    const ev = this.#event(eventId);
    const ids = ev.items.map((it) => it.id);
    const from = ids.indexOf(itemId);
    if (from < 0) throw new StoreError(`Playlist item not found: ${itemId}`);
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, itemId);
    return this.reorderItems(eventId, ids);
  }

  /**
   * Set a deck's presenter name, talk title, and/or the first and last page it plays.
   * Presenter and title are optional text; "" clears one. firstPage and lastPage are whole
   * page numbers; null or "" clears one (back to "from page 1" / "to the end").
   * Anything else in the patch is ignored. Nothing is saved if any value is refused.
   */
  updateItem(eventId, itemId, patch = {}) {
    const ev = this.#event(eventId);
    const it = ev.items.find((x) => x.id === itemId);
    if (!it) throw new StoreError(`Playlist item not found: ${itemId}`);
    // Work out every new value first, so a refused value leaves the deck completely unchanged.
    const next = { presenter: it.presenter, title: it.title, firstPage: it.firstPage, lastPage: it.lastPage };
    for (const key of ['presenter', 'title']) {
      if (!(key in (patch || {}))) continue;
      if (patch[key] != null && typeof patch[key] !== 'string') {
        throw new StoreError(`${key === 'presenter' ? 'Presenter' : 'Talk title'} must be text`);
      }
      next[key] = cleanText(patch[key]);
    }
    try {
      if ('firstPage' in (patch || {})) next.firstPage = parsePageNumber(patch.firstPage, 'First page');
      if ('lastPage' in (patch || {})) next.lastPage = parsePageNumber(patch.lastPage, 'Last page');
    } catch (err) {
      throw new StoreError(err.message);
    }
    if (next.firstPage === 1) next.firstPage = null; // "from page 1" is the same as not set
    if (next.firstPage !== null && next.lastPage !== null && next.lastPage < next.firstPage) {
      throw new StoreError(`Last page (${next.lastPage}) must not be before the first page (${next.firstPage})`);
    }
    const changed = Object.keys(next).some((key) => it[key] !== next[key]);
    Object.assign(it, next);
    if (changed) this.#save();
    return this.#clone(it);
  }

  /** A new, unused file name in the library, for an edited copy of a deck. */
  newLibraryFile() {
    return `${newId()}.pdf`;
  }

  /**
   * Point a deck at an edited copy of its PDF (already written to the library as `newFile`).
   * The copy the deck was added with is remembered so the edit can be undone, the page
   * range is cleared (its page numbers no longer mean the same pages), and library files
   * nothing uses any more are removed.
   */
  replaceItemFile(eventId, itemId, newFile, pageCount) {
    const ev = this.#event(eventId);
    const it = ev.items.find((x) => x.id === itemId);
    if (!it) throw new StoreError(`Playlist item not found: ${itemId}`);
    const file = path.basename(String(newFile));
    if (!file.endsWith('.pdf') || !fs.existsSync(this.libraryPath(file))) throw new StoreError('The edited PDF was not found in the library');
    if (!it.originalFile) it.originalFile = it.file;
    it.file = file;
    it.pageCount = Number.isInteger(pageCount) && pageCount >= 0 ? pageCount : null;
    it.firstPage = null;
    it.lastPage = null;
    this.#save();
    this.gcLibrary();
    return this.#clone(it);
  }

  /** Undo every page edit on a deck: go back to the PDF as it was added. */
  restoreItemOriginal(eventId, itemId) {
    const ev = this.#event(eventId);
    const it = ev.items.find((x) => x.id === itemId);
    if (!it) throw new StoreError(`Playlist item not found: ${itemId}`);
    if (!it.originalFile) throw new StoreError('This deck has not been edited, so there is nothing to restore');
    if (!fs.existsSync(this.libraryPath(it.originalFile))) throw new StoreError('The original copy of this deck is no longer in the library');
    it.file = it.originalFile;
    it.originalFile = null;
    it.pageCount = null; // re-read from the file
    it.firstPage = null;
    it.lastPage = null;
    this.#save();
    this.gcLibrary();
    return this.#clone(it);
  }

  setItemPageCount(eventId, itemId, pageCount) {
    const ev = this.#event(eventId, { allowPractice: true });
    const it = ev.items.find((x) => x.id === itemId);
    if (!it) throw new StoreError(`Playlist item not found: ${itemId}`);
    const n = Number(pageCount);
    if (!Number.isInteger(n) || n < 0) throw new StoreError(`Invalid page count: ${pageCount}`);
    if (it.pageCount !== n) {
      it.pageCount = n;
      this.#save();
    }
    return this.#clone(it);
  }

  /** Delete library files that no event references any more. Returns the number removed. */
  gcLibrary() {
    const used = new Set(this.data.events.flatMap((e) => e.items.flatMap((it) => [it.file, it.originalFile])));
    for (const it of this.practice?.items || []) used.add(it.file);
    let removed = 0;
    try {
      for (const f of fs.readdirSync(this.libraryDir)) {
        if (f.endsWith('.pdf') && !used.has(f)) {
          fs.rmSync(path.join(this.libraryDir, f), { force: true });
          removed += 1;
        }
      }
    } catch (err) {
      debug('store', 'library cleanup failed', err);
    }
    if (removed) debug('store', `library cleanup removed ${removed} file(s)`);
    return removed;
  }

  // ---------- practice ----------

  #removePracticeFiles(except) {
    try {
      for (const f of fs.readdirSync(this.libraryDir)) {
        if (f.startsWith(PRACTICE_FILE_PREFIX) && f !== except) fs.rmSync(path.join(this.libraryDir, f), { force: true });
      }
    } catch (err) {
      debug('store', 'could not clean up practice files', err);
    }
  }

  /**
   * Set up a one-deck event for practising a single PDF. Nothing about it is
   * saved: it is not in the event list, not in events.json, and its copy of the
   * PDF is removed when practice ends. Starting a new practice replaces the old one.
   * Settings that are missing or out of range fall back to the 20 x 20 defaults.
   * @returns {object} the practice event (id PRACTICE_EVENT_ID, one item)
   */
  startPractice(filePath, { timePerSlide, maxSlides } = {}) {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new StoreError('File not found');
    if (!isPdfFile(filePath)) throw new StoreError('Not a PDF file');
    const inRange = (v, { min, max }) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
    const id = newId();
    const file = `${PRACTICE_FILE_PREFIX}${id}.pdf`;
    try {
      fs.copyFileSync(filePath, this.libraryPath(file));
    } catch (err) {
      debug('store', `could not copy ${filePath} for practice`, err);
      throw new StoreError(`Could not open the PDF: ${err.message}`);
    }
    const name = cleanName(path.basename(filePath), 'Untitled.pdf');
    this.practice = {
      id: PRACTICE_EVENT_ID,
      practice: true,
      showProgress: true, // someone rehearsing wants to see the time
      name: `Practice: ${name}`,
      timePerSlide: inRange(timePerSlide, LIMITS.timePerSlide) ? Number(timePerSlide) : DEFAULT_TIME_PER_SLIDE,
      maxSlides: inRange(maxSlides, LIMITS.maxSlides) && Number.isInteger(Number(maxSlides)) ? Number(maxSlides) : DEFAULT_MAX_SLIDES,
      items: [{ id, name, file, pageCount: null, presenter: '', title: '', firstPage: null, lastPage: null, originalFile: null }],
      createdAt: new Date().toISOString(),
    };
    this.#removePracticeFiles(file); // the previous practice deck, if any
    debug('store', `practice: ${filePath} -> ${file}`);
    return this.#clone(this.practice);
  }

  /**
   * End practice and remove its copy of the PDF. With `token` (the practice
   * item's id), only that practice is ended, so a late "player closed" for an
   * older practice cannot end a newer one. Returns true if something was ended.
   */
  endPractice(token) {
    if (!this.practice) return false;
    if (token !== undefined && this.practice.items[0].id !== token) return false;
    this.practice = null;
    this.#removePracticeFiles();
    return true;
  }

  // ---------- themes ----------

  #hasTheme(id) {
    return isThemeId(id) || this.data.themes.some((t) => t.id === id);
  }

  /** The user's own themes (built-in themes live in src/lib/themes.js). */
  listThemes() {
    return this.#clone(this.data.themes);
  }

  /** The theme in use: a custom theme's definition, or the built-in one. Never fails. */
  currentTheme() {
    const id = this.data.settings.theme;
    return this.#clone(this.data.themes.find((t) => t.id === id) || themeById(id));
  }

  /**
   * Create a custom theme, or update one when `raw.id` names an existing custom theme.
   * Names are kept unique so the Theme menu never shows two entries that look the same.
   */
  saveTheme(raw) {
    let theme;
    try {
      theme = normalizeTheme(raw);
    } catch (err) {
      throw new StoreError(err.message);
    }
    const existing = theme.id ? this.data.themes.find((t) => t.id === theme.id) : null;
    if (!existing && this.data.themes.length >= LIMITS.customThemes) {
      throw new StoreError(`You can keep up to ${LIMITS.customThemes} themes of your own. Delete one first.`);
    }
    const taken = new Set([...THEMES, ...this.data.themes].filter((t) => t !== existing).map((t) => t.name.toLowerCase()));
    const wanted = theme.name;
    for (let n = 2; taken.has(theme.name.toLowerCase()); n += 1) theme.name = `${wanted} ${n}`;
    if (existing) Object.assign(existing, theme);
    else {
      theme.id = `${CUSTOM_THEME_PREFIX}${newId()}`;
      this.data.themes.push(theme);
    }
    this.#save();
    return this.#clone(existing || theme);
  }

  /** Delete a custom theme. If it was in use, the default theme takes over. Returns the settings. */
  deleteTheme(id) {
    const idx = this.data.themes.findIndex((t) => t.id === id);
    if (idx < 0) throw new StoreError(`Theme not found: ${id}`);
    this.data.themes.splice(idx, 1);
    if (this.data.settings.theme === id) this.data.settings.theme = DEFAULT_THEME_ID;
    this.#save();
    return this.getSettings();
  }

  // ---------- settings ----------

  getSettings() {
    return this.#clone(this.data.settings);
  }

  updateSettings(patch = {}) {
    if ('displayId' in patch) {
      const v = patch.displayId;
      this.data.settings.displayId = v === null || v === '' ? null : Number(v);
    }
    if ('theme' in patch) {
      if (!this.#hasTheme(patch.theme)) throw new StoreError(`Unknown theme: ${patch.theme}`);
      this.data.settings.theme = patch.theme;
    }
    if ('checkUpdates' in patch) {
      if (typeof patch.checkUpdates !== 'boolean') throw new StoreError('The update check setting must be on or off');
      this.data.settings.checkUpdates = patch.checkUpdates;
    }
    if ('lastUpdateCheck' in patch) {
      const when = patch.lastUpdateCheck;
      if (when !== null && (typeof when !== 'string' || Number.isNaN(Date.parse(when)))) throw new StoreError('Invalid update check time');
      this.data.settings.lastUpdateCheck = when;
    }
    this.#save();
    return this.getSettings();
  }
}
