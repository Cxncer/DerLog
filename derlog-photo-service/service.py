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
import re
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

import requests
from pinscrape import Pinterest

def env_int(name, default):
    """Some shells export PORT= or PORT=0; those should not win over the default."""
    try:
        value = int(os.environ.get(name, "").strip())
    except ValueError:
        return default
    return value if value > 0 else default


PORT = env_int("PORT", 3211)
# 0.0.0.0 lets a phone on the same Wi-Fi reach this service at the PC's address.
HOST = (os.environ.get("HOST") or "0.0.0.0").strip()
CACHE_TTL_SECONDS = max(1, env_int("CACHE_TTL_MS", 15 * 60 * 1000)) / 1000
ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGIN", "http://127.0.0.1:54830,http://localhost:54830"
    ).split(",")
    if origin.strip()
]
# DerLog can be opened from a phone on the LAN, where the Origin is the PC's IP.
PRIVATE_ORIGIN = re.compile(
    r"^https?://(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|"
    r"172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$"
)
MIN_LIMIT, MAX_LIMIT, MAX_QUERY = 1, 20, 120
# The slideshow frame is 16:9, so portrait pins are skipped before they reach the page.
MIN_LANDSCAPE_RATIO = float(os.environ.get("MIN_LANDSCAPE_RATIO", "1.2"))

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


def origin_allowed(origin):
    return bool(origin) and (origin in ORIGINS or PRIVATE_ORIGIN.match(origin) is not None)


def thumbnail_url(url):
    """Pinterest serves the same file at several sizes; 236x is enough for cards."""
    return url.replace("/originals/", "/236x/", 1) if "i.pinimg.com/originals/" in url else url


_dimensions = {}


def parse_dimensions(data):
    """Read width/height from the first bytes of a JPEG, PNG, WebP or GIF."""
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                return ((data[i + 7] << 8) | data[i + 8], (data[i + 5] << 8) | data[i + 6])
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = (data[i + 2] << 8) | data[i + 3]
            if length < 2:
                break
            i += 2 + length
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"))
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X" and len(data) >= 30:
            return (1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little"))
        if chunk == b"VP8 " and len(data) >= 30:
            return (
                int.from_bytes(data[26:28], "little") & 0x3FFF,
                int.from_bytes(data[28:30], "little") & 0x3FFF,
            )
        if chunk == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return (int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little"))
    return None


def image_dimensions(url):
    """Read only the image header (64 KB) so no photo is downloaded or stored."""
    cached = _dimensions.get(url)
    if cached and cached[0] > time.time():
        return cached[1]
    dims = None
    try:
        response = requests.get(
            url,
            stream=True,
            timeout=8,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.pinterest.com/",
            },
        )
        try:
            dims = parse_dimensions(response.raw.read(65536, decode_content=True))
        finally:
            response.close()
    except Exception:
        dims = None
    _dimensions[url] = (time.time() + CACHE_TTL_SECONDS, dims)
    return dims


def photo_record(query, url, width=0, height=0):
    return {
        "imageUrl": url,
        "thumbnailUrl": thumbnail_url(url),
        "width": width,
        "height": height,
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

        # Ask for extra results so landscape-only filtering can still fill the request.
        raw_urls = scraper().search(query, min(MAX_LIMIT, max(limit * 3, limit)))
        seen = set()
        photos = []
        for raw in raw_urls:
            url = str(raw or "").strip()
            if not url.startswith("https://i.pinimg.com/") or url in seen:
                continue
            seen.add(url)
            dims = image_dimensions(url)
            if not dims:
                continue
            width, height = dims
            if not height or width / height < MIN_LANDSCAPE_RATIO:
                continue
            photos.append(photo_record(query, url, width, height))
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
            origin if origin_allowed(origin) else ORIGINS[0],
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
