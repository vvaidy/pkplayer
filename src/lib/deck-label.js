// What the player's waiting screen says about the deck that is up next.
// Pure function, shared by the player and the unit tests.

/**
 * @param {{name?: string, presenter?: string, title?: string}} item the playlist item
 * @param {number} deckIndex 0-based position in the playlist
 * @param {number} deckCount decks in the event
 * @param {number} slideCount slides this deck will play
 * @returns {{presenter: string, title: string, meta: string}}
 *   presenter/title are "" when not set. meta is the small line; it carries the
 *   file name only when there is no presenter or title to show instead.
 */
export function deckLabel(item, deckIndex, deckCount, slideCount) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const presenter = text(item?.presenter);
  const title = text(item?.title);
  const parts = [`PDF ${deckIndex + 1} of ${deckCount}`];
  if (!presenter && !title) parts.push(text(item?.name) || 'Untitled.pdf');
  parts.push(`${slideCount} slide${slideCount === 1 ? '' : 's'}`);
  return { presenter, title, meta: parts.join(' · ') };
}

const MAX_TEXT = 200;
const GENERIC_TITLE = /^(powerpoint presentation|presentation\s*\d*|slide\s*\d+|untitled.*|no slide title|document\s*\d*|title|keynote presentation|google slides)$/i;
const GENERIC_AUTHOR = /^(microsoft office user|windows user|user|admin|administrator|owner|author|unknown|default|student|office|guest|pc|home)$/i;
const APP_PREFIX = /^(microsoft (office )?powerpoint|microsoft word|keynote)\s*-\s*/i;
const DOC_EXTENSION = /\.(pptx?|ppsx?|key|odp|pdf|docx?)$/i;

const tidy = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');
const stem = (v) => tidy(v).replace(DOC_EXTENSION, '').toLowerCase().replace(/[\s_-]+/g, ' ');

/**
 * Default presenter and talk title for a newly added deck, taken from the PDF's
 * own Title and Author properties. Returns "" for anything that is missing or
 * looks machine-made, because a wrong name on the big screen is worse than none:
 * placeholder titles ("PowerPoint Presentation"), a title that is just the file
 * name, and authors that look like an account name or e-mail address.
 * @param {{title?: string, author?: string}|null|undefined} meta PDF properties
 * @param {string} [fileName] the deck's file name
 * @returns {{presenter: string, title: string}}
 */
export function suggestFromMetadata(meta, fileName = '') {
  let title = tidy(meta?.title).replace(APP_PREFIX, '');
  if (GENERIC_TITLE.test(title.replace(DOC_EXTENSION, '')) || (title && stem(title) === stem(fileName))) title = '';
  else if (DOC_EXTENSION.test(title)) title = ''; // "talk-final-v3.pptx" is a file name, not a title

  let presenter = tidy(meta?.author);
  const looksLikeAccount = /@/.test(presenter) || /^[a-z0-9._-]+$/.test(presenter) || !/\p{L}/u.test(presenter);
  if (GENERIC_AUTHOR.test(presenter) || looksLikeAccount) presenter = '';

  return { presenter, title };
}
