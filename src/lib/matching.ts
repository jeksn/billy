/**
 * Device/library book matching helpers.
 *
 * Files on the device are named by whichever app sent them, and Calibre
 * uses title-sorted names with punctuation turned into underscores
 * ("Every, The - Dave Eggers.kepub.epub"), so exact file-name matching
 * only works for books billy itself sent. These helpers normalize titles
 * to a comparable form:
 * - fold diacritics ("här" → "har")
 * - lowercase, strip punctuation, collapse whitespace
 * - drop leading and trailing articles ("the every" ≡ "every, the")
 */

export function normalizeTitle(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized
    .replace(/^(the|a|an) /, '')
    .replace(/ (the|a|an)$/, '')
    .trim()
}

/** The title portion of a "Title - Author" device file name. */
export function deviceTitlePortion(name: string): string {
  const idx = name.lastIndexOf(' - ')
  return idx === -1 ? name : name.slice(0, idx)
}
