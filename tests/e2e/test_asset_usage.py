"""E2E: every image a skin fetches is an image that skin actually uses.

The static suite (`frontend/assetPolicy.test.ts`) answers a different question. It reads
the repository and asks whether a file in `public/` is *named* anywhere -- which catches
dead weight, wrong formats, budget overruns and stale citations, all without a browser.
What it cannot see is a file that is named, correctly, by a page that then never draws
it. `index.html` referenced eight comic-book panels for months; on `barebone` a load
pulled all 1.94 MB of them and painted none. Every static check passed, because every
reference was real.

Only a browser can tell those apart, and it needs two measurements a repo scan has no
equivalent of: what the network fetched, and what the layout ended up using. So:

- **fetched** -- `performance.getEntriesByType('resource')`, which is the browser's own
  record of every byte it went and got, `encodedBodySize` included.
- **used** -- an `<img>` that decoded (`naturalWidth > 0`), a `background-image` on a
  live element, or an `<image>` in an SVG. Anything fetched and absent from that set was
  paid for and thrown away.

**These are still invariants, not benchmarks.** Nothing here times anything: a wall-clock
assertion measures the CI runner, fails on a bad afternoon, and gets muted within a
month. Bytes and request counts are deterministic and caused by this repository, so they
are what a test can own. For the timing half, run a Lighthouse pass or a devtools trace
against a preview -- against something real, where a number that moves means something.

Requires the frontend dev server (see `conftest.py`); excluded from the default run by
`pytest.ini`'s `--ignore=tests/e2e`.

Run:
    pytest tests/e2e/test_asset_usage.py -v
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page

# Mirrors SKIN_NAMES in frontend/src/skins/registry.ts. Kept as a literal on purpose:
# this suite's job is to check the app from the outside, and importing the app's own
# constant would make a skin that was dropped from the registry silently drop out of
# the matrix too.
SKINS = ["carameli", "candy-shop", "barebone", "comic-book"]

# Mirrors the `home` list in the skin guard in frontend/index.html: the panels the '/'
# route draws. Kept as a literal for the same reason SKINS is -- an outside view of what
# the app should be drawing. The exact list is the static suite's business; here only the
# count matters.
#
# It is deliberately NOT the length of PANEL_IMG_TRANSFORMS. That array spans both grids,
# and `pageForPath` in src/skins/comic-book/panels.ts sends '/' to the four-panel home
# grid while every other route gets the classic eight. Counting the whole array is what
# made this test demand eight images from a page that asks for four, and it went unnoticed
# because Firefox fetches an eighth resource of its own accord: the threshold was met in
# one browser out of three, while Chromium and WebKit reported seven and failed.
HOME_PANELS = 4

# Fetched by the browser itself, never by the page: the PWA manifest's icon set and the
# tab favicon. They are legitimately absent from the DOM, so exempting them is the
# difference between a real finding and noise on every run.
NOT_DRAWN_BY_THE_PAGE = ("/icons/", "/favicon.ico")

# What a skin that draws no photographic art is allowed to fetch. Only the PWA icon the
# manifest names should land, and it is under 64 KB; the ceiling leaves room for a
# second icon without leaving room for a panel. Before the skin guard in `index.html`
# these skins fetched 2,098,810 bytes each, so this is the ratchet on that fix.
MAX_INCIDENTAL_IMAGE_BYTES = 128 * 1024

# The whole point of the comic-book skin is the panel art, so it has its own ceiling.
# It matches MAX_PRELOAD_BYTES in frontend/assetPolicy.ts plus the PWA icon; if the two
# ever disagree, the static budget is the one to trust and this is the stale copy.
MAX_COMIC_BOOK_IMAGE_BYTES = 2_200 * 1024

# Collected after load: what the network fetched, and what the layout is using. Both are
# read in one pass so they describe the same moment.
COLLECT_IMAGE_USAGE = """
() => {
  const isImage = (url) => /\\.(webp|png|jpe?g|avif|gif|svg|ico)(\\?|$)/i.test(url)
  const normalise = (url) => {
    try { return decodeURI(new URL(url, location.href).pathname) } catch { return url }
  }

  const fetched = performance.getEntriesByType('resource')
    .filter((entry) => entry.initiatorType === 'img' || isImage(entry.name))
    .map((entry) => ({ url: normalise(entry.name), bytes: entry.encodedBodySize || 0 }))

  const used = new Set()
  for (const img of document.querySelectorAll('img')) {
    // naturalWidth is 0 for an <img> that is still loading or that failed, so this is
    // "decoded and available to paint" rather than "an element exists".
    if (img.naturalWidth > 0 && img.currentSrc) used.add(normalise(img.currentSrc))
  }
  for (const node of document.querySelectorAll('image')) {
    const href = node.getAttribute('href') || node.getAttribute('xlink:href')
    if (href) used.add(normalise(href))
  }
  for (const node of document.querySelectorAll('*')) {
    const style = getComputedStyle(node)
    // `cursor` belongs here with the paint properties: a custom cursor is an image the
    // page asked for and the compositor draws. Leaving it out reported comic-book's two
    // cursor sprites as fetched-but-never-drawn on every browser from the night they
    // landed, which is a false finding, not a payload to delete.
    for (const value of [
      style.backgroundImage,
      style.borderImageSource,
      style.maskImage,
      style.cursor,
    ]) {
      if (!value || value === 'none') continue
      for (const match of value.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)) {
        used.add(normalise(match[1]))
      }
    }
  }

  return { fetched, used: [...used] }
}
"""


def _load_skin(page: Page, skin: str) -> dict[str, object]:
    """Load the app as a first-time visitor on ``skin`` and report its image traffic."""
    # add_init_script runs before any page script, so the guard in index.html sees the
    # skin on the very first load. Setting it after goto() would measure a page that
    # had already decided what to fetch.
    page.add_init_script(f"localStorage.setItem('skin', {skin!r})")
    page.goto("/")
    page.wait_for_load_state("networkidle")
    # The comic-book layout gates its ready state on the last panel to decode; a page
    # measured before that reports art as fetched-but-unused for timing reasons alone.
    page.wait_for_timeout(1500)
    return dict(page.evaluate(COLLECT_IMAGE_USAGE))


def _kb(byte_count: float) -> str:
    return f"{byte_count / 1024:.1f} KB"


def test_the_collector_sees_the_traffic_it_is_measuring(page: Page) -> None:
    """An empty measurement must not read as a clean one.

    Every assertion in this module passes trivially on a page that fetched nothing, and
    "fetched nothing" is exactly what a broken selector, a dev server that 404s, or a
    page that never mounted all look like. Three of the four skins legitimately fetch no
    images now, so the check cannot live in the per-skin tests -- it lives here, on the
    one skin whose whole design is panel art.
    """
    usage = _load_skin(page, "comic-book")
    fetched = list(usage["fetched"])  # type: ignore[call-overload]
    used = set(usage["used"])  # type: ignore[call-overload]

    assert len(fetched) >= HOME_PANELS, (
        f"comic-book fetched {len(fetched)} image(s); the home grid draws {HOME_PANELS} "
        "panels. Either the page did not load or the resource collector stopped seeing "
        "images."
    )
    assert used, "No image on the page decoded — the usage collector is reading nothing."


@pytest.mark.parametrize("skin", SKINS)
def test_skin_uses_every_image_it_fetches(page: Page, skin: str) -> None:
    """No skin pays for an image it never draws."""
    usage = _load_skin(page, skin)
    fetched = list(usage["fetched"])  # type: ignore[call-overload]
    used = set(usage["used"])  # type: ignore[call-overload]

    wasted = [
        entry
        for entry in fetched
        if entry["url"] not in used
        and not any(exempt in entry["url"] for exempt in NOT_DRAWN_BY_THE_PAGE)
    ]
    wasted_bytes = sum(int(entry["bytes"]) for entry in wasted)

    assert not wasted, (
        f"The {skin} skin fetched {len(wasted)} image(s) totalling {_kb(wasted_bytes)} "
        "that it never drew:\n  "
        + "\n  ".join(f"{entry['url']} ({_kb(entry['bytes'])})" for entry in wasted)
        + "\n\nThese are bytes on the critical path of a page that has no use for them. "
        "The usual cause is an asset referenced unconditionally from index.html while "
        "only one skin draws it — put it behind the skin guard rather than widening the "
        "exemption list, which exists for assets the browser fetches on its own "
        "(the PWA icon set, the favicon) and not for assets a page asked for."
    )


@pytest.mark.parametrize("skin", SKINS)
def test_skin_stays_within_its_image_budget(page: Page, skin: str) -> None:
    """A skin's total image weight is a ratchet, measured where it is actually paid."""
    usage = _load_skin(page, skin)
    fetched = list(usage["fetched"])  # type: ignore[call-overload]
    total = sum(int(entry["bytes"]) for entry in fetched)

    ceiling = MAX_COMIC_BOOK_IMAGE_BYTES if skin == "comic-book" else MAX_INCIDENTAL_IMAGE_BYTES
    assert total <= ceiling, (
        f"The {skin} skin fetched {_kb(total)} of images, over its {_kb(ceiling)} "
        "ceiling:\n  "
        + "\n  ".join(
            f"{entry['url']} ({_kb(entry['bytes'])})"
            for entry in sorted(fetched, key=lambda item: -int(item["bytes"]))
        )
        + "\n\nThis is measured in the browser, so unlike the static budgets it counts "
        "what a visitor on this skin actually pays. Raising the ceiling is the wrong "
        "fix unless the skin genuinely gained art; the previous time this number moved "
        "it was one skin's assets being fetched by all four."
    )
