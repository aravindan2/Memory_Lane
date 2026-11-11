# Assignment 3 — Photo Search & Upload Frontend

A dependency-free frontend (plain HTML/CSS/JS, no build step) that:

1. **Searches** photos via `GET /search`
2. **Displays** the returned photos in a responsive results grid
3. **Uploads** photos via `PUT /photos`, with **one or more custom labels** supplied in the upload form

## Run it

Serve the folder with any static server:

```bash
cd Assignment3
python3 -m http.server 8080
# then open http://localhost:8080
```

(or `npx serve .`, or open `index.html` directly — a static server is recommended so `fetch` behaves consistently.)

The backend is expected at `http://localhost:5000`.

> **CORS:** because the page and the API are on different origins, the backend must
> allow cross-origin requests. In Flask:
> ```python
> from flask_cors import CORS
> CORS(app)  # or CORS(app, origins=["http://localhost:8080"])
> ```

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup: search form, results grid, upload form with label chips |
| `css/styles.css` | All styling |
| `js/config.js` | **All backend assumptions live here** — API base, endpoint paths, query-param names, multipart field names |
| `js/api.js` | API client: `searchPhotos()`, `uploadPhoto()`, response normalization, relative-URL resolution, timeouts/errors |
| `js/app.js` | UI wiring: rendering results, label chip management, form submit handlers |

## The API contract this scaffold assumes

Adjust any of it in `js/config.js` — no other file needs to change.

### `GET /search`

```
GET /search?q=<query>&labels=<label1,label2>
```

| Param | Name (configurable) | Notes |
|---|---|---|
| query text | `q` | omitted when empty |
| labels | `labels` | comma-joined, omitted when empty |

Accepted response shapes (all are normalized automatically):

```jsonc
[ { "id": 1, "url": "/photos/1.jpg", "caption": "Sunset", "labels": ["beach"] } ]   // bare array
{ "results": [ ... ] }   // also: { "photos": [...] }, { "items": [...] }, { "data": [...] }
```

Per-photo fields recognized (first match wins):

- **image URL:** `url` → `imageUrl` → `image` → `src`
- **title:** `caption` → `title` → `name` → `filename`
- **labels:** `labels` → `tags` → `label` (string, comma-separated string, or array)
- **id:** `id` → `photoId` → `_id`

Relative URLs (e.g. `/photos/1.jpg`) are resolved against the API base —
set `resolveRelativeUrls: false` if your backend returns full URLs only.

### `PUT /photos`

`multipart/form-data`:

| Field | Config key | Notes |
|---|---|---|
| file binary | `upload.fileField` = `file` | sent with the file's original filename |
| custom label | `upload.labelsField` = `label` | **repeated once per label** |

Success: any `2xx` (a `204` empty body is handled). A JSON body, if returned, is
surfaced by the client (it is not required).

Example with curl to verify against your backend:

```bash
curl -X PUT http://localhost:5000/photos \
  -F "file=@./sunset.jpg" \
  -F "label=beach" -F "label=2024"
```

## Configuring it later

Three ways, highest priority first:

1. **URL parameter:** `http://localhost:8080/?apiBase=http://localhost:8000`
2. **localStorage:** `localStorage.setItem("photoApp.config", JSON.stringify({ apiBase: "http://localhost:8000" }))`
3. **Edit defaults** at the top of `js/config.js`

`js/config.js` also lets you rename endpoints (`/search`, `/photos`), the query
param names (`q`, `labels`), and the multipart field names (`file`, `label`).

## UI notes

- **Search:** query box + optional comma-separated label filter; Enter submits; Clear resets.
- **Results:** responsive card grid with image, caption, label chips and id; loading, empty and error states.
- **Upload:** file picker with thumbnail preview (multiple files allowed — they are PUT sequentially), a **label chip input** (type + Enter or *Add*, click `×` or Backspace to remove, at least one label required), success/error status line. Labels you've used before are offered as autocomplete suggestions.
