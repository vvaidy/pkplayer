// Persistent storage for Events, their playlists and app settings.
// Data lives in <dataDir>/events.json; imported PDFs are copied to <dataDir>/library/
// so events keep working if the originals are moved or deleted.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { debug } from '../lib/debug.js';
import { DEFAULT_MAX_SLIDES, DEFAULT_TIME_PER_SLIDE } from '../lib/player-controller.js';

export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({
  timePerSlide: { min: 0.5, max: 3600 },
  maxSlides: { min: 1, max: 999 },
  nameLength: 200,
});

export class StoreError extends Error {}

const newId = () => crypto.randomUUID();

function emptyData() {
  return { version: SCHEMA_VERSION, settings: { displayId: null }, events: [] };
}

function clampNumber(value, { min, max }, label, { integer = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new StoreError(`${label} must be a number (got "${value}")`);
  if (integer && !Number.isInteger(n)) throw new StoreError(`${label} must be a whole number (got ${n})`);
  if (n < min || n > max) throw new StoreError(`${label} must be between ${min} and ${max} (got ${n})`);
  return n;
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
  }

  // ---------- persistence ----------

  #load() {
    if (!fs.existsSync(this.file)) return emptyData();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, { encoding: 'utf-8' }));
      const data = emptyData();
      data.settings = { ...data.settings, ...(raw.settings || {}) };
      data.events = (Array.isArray(raw.events) ? raw.events : []).map((e) => ({
        id: String(e.id || newId()),
        name: cleanName(e.name, 'Untitled Event'),
        timePerSlide: Number(e.timePerSlide) > 0 ? Number(e.timePerSlide) : DEFAULT_TIME_PER_SLIDE,
        maxSlides: Number.isInteger(e.maxSlides) && e.maxSlides >= 1 ? e.maxSlides : DEFAULT_MAX_SLIDES,
        items: (Array.isArray(e.items) ? e.items : [])
          .filter((it) => it && it.file)
          .map((it) => ({
            id: String(it.id || newId()),
            name: cleanName(it.name, 'Untitled.pdf'),
            file: path.basename(String(it.file)),
            pageCount: Number.isInteger(it.pageCount) ? it.pageCount : null,
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

  #event(id) {
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
    return this.#clone(this.#event(id));
  }

  createEvent(name) {
    const ev = {
      id: newId(),
      name: cleanName(name, `Event ${this.data.events.length + 1}`),
      timePerSlide: DEFAULT_TIME_PER_SLIDE,
      maxSlides: DEFAULT_MAX_SLIDES,
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
        added.push({ id, name: cleanName(path.basename(p), 'Untitled.pdf'), file, pageCount: null });
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

  setItemPageCount(eventId, itemId, pageCount) {
    const ev = this.#event(eventId);
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
    const used = new Set(this.data.events.flatMap((e) => e.items.map((it) => it.file)));
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

  // ---------- settings ----------

  getSettings() {
    return this.#clone(this.data.settings);
  }

  updateSettings(patch = {}) {
    if ('displayId' in patch) {
      const v = patch.displayId;
      this.data.settings.displayId = v === null || v === '' ? null : Number(v);
    }
    this.#save();
    return this.getSettings();
  }
}
