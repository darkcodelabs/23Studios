# keygenmusic.tk scraper

Python scraper that captures the first 25 tracker-music files listed on
[keygenmusic.tk](https://keygenmusic.tk/) along with their metadata.

## What it does

1. Loads the site's track index from `https://keygenmusic.tk/kgm/lib.txt`
   (the same JSON array the site's own player consumes).
2. Selects the first 25 entries — same order the homepage renders.
3. Downloads each module file (`.mod`, `.s3m`, `.xm`, `.it`, …) into
   `./downloads/keygenmusic/`.
4. Writes a metadata manifest to `./downloads/keygenmusic/manifest.json`.
5. Logs progress to stdout and to `./downloads/keygenmusic/scrape.log`.

The scraper does **not** use Selenium or any headless browser. The
homepage's track list is JS-rendered, but the underlying data is a static
JSON file fetched directly.

## Legal & ethical disclaimer

Keygen music sits in a gray legal area: the audio is composed by scene
authors and embedded inside cracker utilities. keygenmusic.tk preserves
these tracks as a historical / archival listening project.

**This scraper is for personal research and prototype use only.** Do not
redistribute the downloaded audio, do not host it elsewhere, do not bundle
it into a product. If a composer or rights holder objects, delete the
files. Review keygenmusic.tk's own terms before running.

The audio files themselves are intentionally gitignored — only the scraper
code lives in this repository.

## Captured metadata per track

| Field            | Source                                             |
| ---------------- | -------------------------------------------------- |
| `title`          | `mdt` (internal mod title) — falls back to `sn`    |
| `composer`       | `rg` (scene/group handle credited on the keygen)   |
| `release_group`  | `rg`                                               |
| `year`           | `null` — not exposed by the site                   |
| `source_url`     | `https://keygenmusic.tk/#track=…` share link       |
| `format`         | file extension (`mod`, `s3m`, `xm`, `it`, …)       |
| `download_url`   | direct URL under `/kgm/`                           |
| `mod_title`      | `mdt` raw value                                    |
| `keygen_target`  | `sn` raw value                                     |
| `display_title`  | `st` raw value                                     |
| `local_path`     | where the file landed, if download succeeded       |
| `bytes`          | downloaded byte count                              |
| `status`         | `ok` or `failed`                                   |

`year` is null because the upstream library does not record per-track
upload dates or original release years.

## Running it

```bash
cd tools/keygenmusic_scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scraper.py
```

Files land in `./downloads/keygenmusic/` (relative to wherever you ran it
from). Re-running overwrites them.

## Politeness

- 2-second delay between requests
- User-Agent: `hakcd-scraper/0.1 (research, not for redistribution)`
- One retry on 5xx with 4-second backoff, then skipped + logged
- Honors `robots.txt` if present (aborts if `/kgm/` is disallowed)

## What lands where

```
./downloads/keygenmusic/
  manifest.json     ← per-track metadata (gitignored)
  scrape.log        ← run log (gitignored)
  *.xm, *.mod, …    ← downloaded modules (gitignored)
```

Both the tool-local `.gitignore` and the repo-root `.gitignore` keep these
out of git.
