#!/usr/bin/env python3
"""DerLog photo service.

Wraps pinscrape (https://github.com/iamatulsingh/pinscrape) in a tiny local JSON
API so DerLog can ask for destination photos without embedding scraper code in
the browser. Only image URLs are returned; nothing is downloaded or re-hosted.

    GET /health
    GET /api/photos?query=Battambang&limit=10

Run from this folder:

    .venv/Scripts/python service.py
"""

import json
import os
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

from pinscrape import Pinterest

def env_int(name, default):
    """Some shells export PORT= or PORT=0; those should not win over the default."""
    try:
        value = int(os.environ.get(name, "").strip())
    except ValueError:
        return default
    return value if value > 0 else default


PORT = env_int("PORT", 3211)
HOST = (os.environ.get("HOST") or "127.0.0.1").strip()
CACHE_TTL_SECONDS = max(1, env_int("CACHE_TTL_MS", 15 * 60 * 1000)) / 1000
ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGIN", "http://127.0.0.1:54830,http://localhost:54830"
    ).split(",")
    if origin.strip()
]
MIN_LIMIT, MAX_LIMIT, MAX_QUERY = 1, 20, 120

_cache = {}
_cache_lock = threading.Lock()
_search_lock = threading.Lock()
_scraper = None
_scraper_lock = threading.Lock()


def scraper():
    """One Pinterest session for the process; pinscrape keeps its own cookies."""
    global _scraper
    with _scraper_lock:
        if _scraper is None:
            _scraper = Pinterest(sleep_time=1)
        return _scraper


def thumbnail_url(url):
    """Pinterest serves the same file at several sizes; 236x is enough for cards."""
    return url.replace("/originals/", "/236x/", 1) if "i.pinimg.com/originals/" in url else url


def photo_record(query, url):
    return {
        "imageUrl": url,
        "thumbnailUrl": thumbnail_url(url),
        "title": f"{query} - Pinterest",
        "creator": "Pinterest creator",
        "creatorUrl": "",
        "source": "Pinterest",
        "sourceUrl": f"https://www.pinterest.com/search/pins/?q={quote(query)}",
        "license": "See the original Pin and its rights holder",
        "licenseUrl": "",
    }


def discover(query, limit):
    """Return (photos, cached). Image URLs only; pinscrape does the searching."""
    key = (query.lower(), limit)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1], True

    with _search_lock:
        with _cache_lock:
            hit = _cache.get(key)
            if hit and hit[0] > now:
                return hit[1], True

        raw_urls = scraper().search(query, limit)
        seen = set()
        photos = []
        for raw in raw_urls:
            url = str(raw or "").strip()
            if not url.startswith("https://i.pinimg.com/") or url in seen:
                continue
            seen.add(url)
            photos.append(photo_record(query, url))
            if len(photos) >= limit:
                break

        with _cache_lock:
            _cache[key] = (time.time() + CACHE_TTL_SECONDS, photos)
        return photos, False


class Handler(BaseHTTPRequestHandler):
    server_version = "DerLogPhotoService/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def cors_headers(self):
        origin = self.headers.get("Origin")
        self.send_header(
            "Access-Control-Allow-Origin",
            origin if origin in ORIGINS else ORIGINS[0],
        )
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if origin:
            self.send_header("Vary", "Origin")

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.cors_headers()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            return self.send_json(
                200,
                {
                    "ok": True,
                    "service": "DerLog Pinterest photo service",
                    "library": "pinscrape",
                    "cachedQueries": len(_cache),
                },
            )

        if parsed.path != "/api/photos":
            return self.send_json(404, {"ok": False, "error": "Not found"})

        params = parse_qs(parsed.query)
        query = " ".join((params.get("query") or [""])[0].split())[:MAX_QUERY]
        try:
            limit = int((params.get("limit") or ["10"])[0])
        except ValueError:
            limit = 10
        limit = max(MIN_LIMIT, min(MAX_LIMIT, limit))

        if len(query) < 2:
            return self.send_json(
                400, {"ok": False, "error": "Provide a destination query of at least 2 characters."}
            )

        try:
            photos, cached = discover(query, limit)
        except Exception as error:  # Pinterest blocks, DNS, rate limits, parser changes
            traceback.print_exc()
            return self.send_json(
                502, {"ok": False, "error": f"Pinterest search failed: {error}"}
            )

        return self.send_json(
            200,
            {
                "ok": True,
                "query": query,
                "count": len(photos),
                "cached": cached,
                "photos": photos,
                "providers": ["Pinterest (pinscrape)"],
            },
        )


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"DerLog photo service listening at http://{HOST}:{PORT}", flush=True)
    print("Allowed Origins: " + ", ".join(ORIGINS), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
