/**
 * Two-word codenames used as a campaign-scoped handle for volunteers.
 *
 * Wordlists are intentionally limited to nature, weather, materials, and
 * abstract qualities. They avoid: human descriptors, ethnic or national
 * references, religious terms, place-specific names, and color words that
 * have been used as racial shorthand (black, white, brown, yellow, red).
 */

export const CODENAME_ADJECTIVES: readonly string[] = [
  "amber",
  "azure",
  "balmy",
  "breezy",
  "brisk",
  "calm",
  "cobalt",
  "copper",
  "cosmic",
  "crimson",
  "dusky",
  "frosty",
  "gentle",
  "golden",
  "hazel",
  "indigo",
  "ivory",
  "jade",
  "lilac",
  "lively",
  "lunar",
  "marble",
  "mossy",
  "nimble",
  "opal",
  "pearly",
  "pewter",
  "plucky",
  "quartz",
  "rapid",
  "ruby",
  "sage",
  "silver",
  "slate",
  "smoky",
  "solar",
  "stormy",
  "sunny",
  "swift",
  "teal",
  "topaz",
  "velvet",
  "violet",
  "willow",
  "zesty",
];

export const CODENAME_NOUNS: readonly string[] = [
  "arrow",
  "basin",
  "beacon",
  "bramble",
  "breeze",
  "brook",
  "canyon",
  "cascade",
  "cedar",
  "cliff",
  "comet",
  "coral",
  "crest",
  "dawn",
  "delta",
  "dune",
  "ember",
  "falcon",
  "fern",
  "fjord",
  "forest",
  "gale",
  "glade",
  "glow",
  "grove",
  "harbor",
  "haven",
  "heath",
  "knoll",
  "lagoon",
  "lantern",
  "leaf",
  "marsh",
  "meadow",
  "mesa",
  "moor",
  "nebula",
  "oasis",
  "orchard",
  "peak",
  "prairie",
  "ridge",
  "river",
  "shoal",
  "sky",
  "spire",
  "stream",
  "summit",
  "thicket",
  "tide",
  "vale",
  "vista",
];

export const CODENAME_PATTERN = /^[a-z]{3,12}-[a-z]{3,12}$/;

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

/**
 * Generate a "purple-haze"-style codename. Pass a custom RNG for tests; the
 * default uses crypto.getRandomValues so codenames are unpredictable enough
 * to avoid collisions on a small campaign without coordinating state.
 */
export function generateCodename(rand: () => number = secureRandom): string {
  return `${pick(CODENAME_ADJECTIVES, rand)}-${pick(CODENAME_NOUNS, rand)}`;
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}

export function isValidCodename(s: string): boolean {
  if (!CODENAME_PATTERN.test(s)) return false;
  const [adj, noun] = s.split("-");
  return CODENAME_ADJECTIVES.includes(adj) && CODENAME_NOUNS.includes(noun);
}
