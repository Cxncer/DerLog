# DerLog photo service (pinscrape)

A small local JSON API that finds destination photos on Pinterest using
[pinscrape](https://github.com/iamatulsingh/pinscrape), so DerLog's slideshow does not
need scraper code or credentials in the browser.

It returns image URLs only. It never downloads, stores or re-hosts an image.

## Endpoints

```text
GET http://127.0.0.1:3211/health
GET http://127.0.0.1:3211/api/photos?query=Battambang&limit=10
```

```json
{
  "ok": true,
  "query": "Battambang",
  "count": 10,
  "cached": false,
  "photos": [
    {
      "imageUrl": "https://i.pinimg.com/originals/....jpg",
      "thumbnailUrl": "https://i.pinimg.com/236x/....jpg",
      "title": "Battambang - Pinterest",
      "creator": "Pinterest creator",
      "source": "Pinterest",
      "sourceUrl": "https://www.pinterest.com/search/pins/?q=Battambang",
      "license": "See the original Pin and its rights holder"
    }
  ],
  "providers": ["Pinterest (pinscrape)"]
}
```

Results are cached in memory for 15 minutes (`CACHE_TTL_MS`). The page never caches them.

## Install (Python 3.14)

pinscrape's published pins (`pydantic~=2.10.3`, `numpy~=2.3.1`) predate Python 3.14,
so install newer builds first and then pinscrape without its pins:

```powershell
cd derlog-photo-service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install --no-deps pinscrape==5.2.0
```

On Python 3.12 or older, `pip install pinscrape` on its own is enough.

## Run

```powershell
cd derlog-photo-service
.venv\Scripts\python service.py
```

It listens on `http://127.0.0.1:3211` and allows DerLog's real origins,
`http://127.0.0.1:54830` and `http://localhost:54830`. Override with environment
variables if you serve DerLog elsewhere:

```powershell
$env:PORT="3211"
$env:HOST="127.0.0.1"
$env:CORS_ORIGIN="http://127.0.0.1:54830,http://localhost:54830"
$env:CACHE_TTL_MS="900000"
.venv\Scripts\python service.py
```

## How DerLog uses it

`fetchPhotographs()` in `DerLog-v19.html` calls `/api/photos` and keeps
`trip.slideshow` as an array of URL strings, so existing trips, backups and Google Drive
sync are unchanged. If the service is not running, DerLog falls back to its built-in
Wikimedia/Openverse search.

## Rights and terms

pinscrape drives Pinterest's internal search endpoints, which Pinterest does not offer
publicly. Automated access may conflict with Pinterest's Terms of Service, and a Pin's
presence on Pinterest does not grant a licence to reuse the image. This service keeps
photos as remote Pinterest URLs and shows `source: Pinterest`; verify rights for any
image you publish or share, and expect Pinterest to rate-limit or block requests.
