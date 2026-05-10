"""Two-word codenames used as a campaign-scoped handle for volunteers.

Wordlists avoid human descriptors, ethnic/national/religious references,
and color words used as racial shorthand.
"""
import re
import secrets

ADJECTIVES = (
    "amber", "azure", "balmy", "breezy", "brisk", "calm", "cobalt", "copper",
    "cosmic", "crimson", "dusky", "frosty", "gentle", "golden", "hazel",
    "indigo", "ivory", "jade", "lilac", "lively", "lunar", "marble", "mossy",
    "nimble", "opal", "pearly", "pewter", "plucky", "quartz", "rapid", "ruby",
    "sage", "silver", "slate", "smoky", "solar", "stormy", "sunny", "swift",
    "teal", "topaz", "velvet", "violet", "willow", "zesty",
)

NOUNS = (
    "arrow", "basin", "beacon", "bramble", "breeze", "brook", "canyon",
    "cascade", "cedar", "cliff", "comet", "coral", "crest", "dawn", "delta",
    "dune", "ember", "falcon", "fern", "fjord", "forest", "gale", "glade",
    "glow", "grove", "harbor", "haven", "heath", "knoll", "lagoon", "lantern",
    "leaf", "marsh", "meadow", "mesa", "moor", "nebula", "oasis", "orchard",
    "peak", "prairie", "ridge", "river", "shoal", "sky", "spire", "stream",
    "summit", "thicket", "tide", "vale", "vista",
)

PATTERN = re.compile(r"^[a-z]{3,12}-[a-z]{3,12}$")


def generate():
    return f"{secrets.choice(ADJECTIVES)}-{secrets.choice(NOUNS)}"


def is_valid(s):
    if not s or not PATTERN.match(s):
        return False
    parts = s.split("-")
    return parts[0] in ADJECTIVES and parts[1] in NOUNS
