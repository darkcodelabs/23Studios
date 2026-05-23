"""Scrape first 25 tracks listed on keygenmusic.tk.

The site is a single-page app: the homepage loads an empty table and the
JavaScript player fetches the full track index from `/kgm/lib.txt` (a JSON
array). The homepage renders that array as-is, so "first N tracks listed on
the homepage" == "first N entries in lib.txt".

Each entry exposes:
    st  full display string ("<group> - <name>")
    rg  release/scene group (the keygen author's handle)
    sn  keygen target name
    n   1-based index in the library
    mdt  internal mod title (composer's title for the track)
    path  file path relative to site root, e.g. "/kgm/!Others/foo.xm"

The library does NOT expose a per-track upload date or original year, so
those fields are emitted as null. See README for caveats.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
import time
import urllib.parse
import urllib.robotparser
from pathlib import Path

import requests

SITE = "https://keygenmusic.tk"
LIB_URL = f"{SITE}/kgm/lib.txt"
ROBOTS_URL = f"{SITE}/robots.txt"
USER_AGENT = "hakcd-scraper/0.1 (research, not for redistribution)"
TRACK_LIMIT = 25
REQUEST_DELAY_SECONDS = 2.0
RETRY_BACKOFF_SECONDS = 4.0
REQUEST_TIMEOUT_SECONDS = 30

DOWNLOAD_DIR = Path("./downloads/keygenmusic")
MANIFEST_PATH = DOWNLOAD_DIR / "manifest.json"
LOG_PATH = DOWNLOAD_DIR / "scrape.log"


def setup_logging() -> logging.Logger:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("keygenmusic_scraper")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(fmt)
    logger.addHandler(stream)

    file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    return logger


def check_robots(logger: logging.Logger) -> bool:
    """Honor robots.txt if present.

    keygenmusic.tk has no real robots.txt — `/robots.txt` returns the SPA
    HTML page, which would mis-parse as disallow-all. Treat any non-plain
    response as "no robots file" = allow.
    """
    try:
        resp = requests.get(
            ROBOTS_URL,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.info("robots.txt unreachable (%s); continuing", exc)
        return True

    if resp.status_code != 200:
        logger.info("robots.txt HTTP %d; treating as absent (allow)", resp.status_code)
        return True

    content_type = resp.headers.get("Content-Type", "").lower()
    body = resp.text
    if "text/plain" not in content_type or body.lstrip().lower().startswith("<"):
        logger.info("robots.txt is not plain text (%s); treating as absent (allow)", content_type)
        return True

    rp = urllib.robotparser.RobotFileParser()
    rp.parse(body.splitlines())
    allowed_lib = rp.can_fetch(USER_AGENT, LIB_URL)
    allowed_kgm = rp.can_fetch(USER_AGENT, f"{SITE}/kgm/")
    if not (allowed_lib and allowed_kgm):
        logger.error("robots.txt disallows scraping of /kgm/ — aborting")
        return False
    logger.info("robots.txt: allowed")
    return True


def build_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    return s


def get_with_retry(
    session: requests.Session,
    url: str,
    logger: logging.Logger,
    stream: bool = False,
) -> requests.Response | None:
    """GET with one retry on 5xx (exponential backoff). Returns None on final failure."""
    for attempt in (1, 2):
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS, stream=stream)
        except requests.RequestException as exc:
            logger.warning("attempt %d: network error fetching %s: %s", attempt, url, exc)
            if attempt == 1:
                time.sleep(RETRY_BACKOFF_SECONDS)
                continue
            return None

        if 500 <= resp.status_code < 600:
            logger.warning("attempt %d: %d on %s", attempt, resp.status_code, url)
            resp.close()
            if attempt == 1:
                time.sleep(RETRY_BACKOFF_SECONDS)
                continue
            return None

        if resp.status_code >= 400:
            logger.error("HTTP %d on %s — not retried", resp.status_code, url)
            resp.close()
            return None

        return resp

    return None


def fetch_library(session: requests.Session, logger: logging.Logger) -> list[dict] | None:
    logger.info("fetching library index: %s", LIB_URL)
    resp = get_with_retry(session, LIB_URL, logger)
    if resp is None:
        return None
    try:
        data = resp.json()
    except ValueError as exc:
        logger.error("library index was not JSON: %s", exc)
        return None
    finally:
        resp.close()
    if not isinstance(data, list):
        logger.error("library index root is not a JSON array (got %s)", type(data).__name__)
        return None
    logger.info("library index loaded: %d total tracks", len(data))
    return data


def to_record(entry: dict) -> dict:
    path = entry.get("path", "")
    rel = path.lstrip("/")
    fmt = os.path.splitext(path)[1].lower().lstrip(".") or None
    music_dir_prefix = "kgm/"
    share_fragment = rel[len(music_dir_prefix):] if rel.startswith(music_dir_prefix) else rel
    source_url = f"{SITE}/#track={urllib.parse.quote(share_fragment)}"
    download_url = f"{SITE}/{urllib.parse.quote(rel)}"

    title = entry.get("mdt") or entry.get("sn") or entry.get("st") or ""

    return {
        "index": entry.get("n"),
        "title": title,
        "composer": entry.get("rg") or None,
        "release_group": entry.get("rg") or None,
        "year": None,
        "source_url": source_url,
        "format": fmt,
        "download_url": download_url,
        "remote_path": path,
        "display_title": entry.get("st"),
        "keygen_target": entry.get("sn"),
        "mod_title": entry.get("mdt") or None,
    }


def safe_local_name(remote_path: str) -> str:
    name = remote_path.rsplit("/", 1)[-1] or "untitled"
    return "".join(c for c in name if c not in "\x00\r\n")


def download_file(
    session: requests.Session,
    url: str,
    dest: Path,
    logger: logging.Logger,
) -> tuple[bool, int]:
    resp = get_with_retry(session, url, logger, stream=True)
    if resp is None:
        return False, 0
    total = 0
    try:
        with dest.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                fh.write(chunk)
                total += len(chunk)
    except OSError as exc:
        logger.error("write failed for %s: %s", dest, exc)
        resp.close()
        return False, total
    resp.close()
    return True, total


def main() -> int:
    logger = setup_logging()
    logger.info("=== keygenmusic.tk scraper start ===")
    logger.info("download dir: %s", DOWNLOAD_DIR.resolve())

    if not check_robots(logger):
        return 2

    session = build_session()

    library = fetch_library(session, logger)
    if library is None:
        logger.error("could not load library — aborting")
        return 1

    selected = library[:TRACK_LIMIT]
    logger.info("selected first %d tracks in homepage order", len(selected))

    manifest: list[dict] = []
    successes = 0
    for i, entry in enumerate(selected, start=1):
        time.sleep(REQUEST_DELAY_SECONDS)
        record = to_record(entry)
        local_name = safe_local_name(record["remote_path"])
        local_path = DOWNLOAD_DIR / local_name
        logger.info(
            "track %d of %d: %s [%s]",
            i, len(selected), record["display_title"], record["format"] or "?",
        )

        ok, size = download_file(session, record["download_url"], local_path, logger)
        record["local_path"] = str(local_path) if ok else None
        record["bytes"] = size if ok else 0
        record["status"] = "ok" if ok else "failed"
        if ok:
            successes += 1
            logger.info("  saved %d bytes -> %s", size, local_path)
        else:
            logger.warning("  skipped after retry exhausted")
        manifest.append(record)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("manifest written: %s (%d records)", MANIFEST_PATH, len(manifest))
    logger.info("=== done: %d / %d downloaded ===", successes, len(selected))
    return 0 if successes == len(selected) else 1


if __name__ == "__main__":
    sys.exit(main())
