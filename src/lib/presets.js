// Timing presets: named combinations of the two event settings.
// Pure data and lookups, shared by the editor and the unit tests.

export const CUSTOM_PRESET_ID = 'custom';

export const PRESETS = [
  { id: 'pechakucha', label: 'PechaKucha', timePerSlide: 20, maxSlides: 20 },
  { id: 'ignite', label: 'Ignite', timePerSlide: 15, maxSlides: 20 },
];

/** The preset with this id, or null (also null for "custom" and anything unknown). */
export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** Id of the preset these settings match exactly, or "custom" when they match none. */
export function presetIdFor(timePerSlide, maxSlides) {
  const time = Number(timePerSlide);
  const max = Number(maxSlides);
  const match = PRESETS.find((p) => p.timePerSlide === time && p.maxSlides === max);
  return match ? match.id : CUSTOM_PRESET_ID;
}
