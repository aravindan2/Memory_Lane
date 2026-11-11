# Assignment 3 — Photo Search & Upload Frontend

A dependency-free frontend (plain HTML/CSS/JS, no build step) that:

1. **Searches** photos via `GET /search`
2. **Displays** the returned photos in a responsive grid — click any photo to open it in a **full-screen viewer (lightbox)**
3. **Uploads** photos via `PUT /photos`, with **one or more custom labels** supplied in the upload form

The UI is a dark, minimal single-screen layout with a floating **pill search bar** at the
bottom: a text field, a funnel button (toggles an optional label filter), a paperclip
button (opens the upload dialog) and a circular search button.

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
| `index.html` | Markup: search dock, results grid, lightbox viewer, upload modal with label chips |
| `css/styles.css` | All styling (dark theme, pill search bar, lightbox, modal) |
| `js/config.js` | **All backend assumptions live here** — API base, endpoint paths, query-param names, multipart field names |
| `js/api.js` | API client: `searchPhotos()`, `uploadPhoto()`, response normalization, relative-URL resolution, timeouts/errors |
| `js/app.js` | UI wiring: rendering results, lightbox, label chips, upload modal, form handlers |

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

## UI guide

- **Search dock (bottom):** type a query and hit Enter or the circular search button.
  The funnel icon reveals an optional comma-separated **label filter** above the pill;
  the paperclip opens the **upload dialog**. `Clear` appears after a search.
- **Results:** responsive card grid with image, caption, label chips and id. Loading,
  empty and error states are shown above the pill.
- **Viewer:** click (or focus + Enter on) any card to open the photo full-screen —
  close with `×`, `Esc`, or clicking the backdrop; "Open original ↗" opens the raw
  image URL in a new tab.
- **Upload dialog:** file picker with thumbnail preview (multiple files allowed —
  they are PUT sequentially) and a **label chip input**: type + Enter or *Add* to add
  (comma-separated values add several at once), `×` or Backspace to remove, at least
  one label required. Previously used labels are offered as autocomplete suggestions.

## Tests

The client and UI were verified with two Node-based harnesses (kept outside this
folder, they don't ship with the app):

- `../.tmp_api_smoke_test.js` — loads `js/config.js` + `js/api.js` and exercises
  query building, response normalization, URL resolution, live `GET /search` and
  `PUT /photos`, and error handling (23 checks).
- `../.tmp_domtest/dom_test.js` — jsdom end-to-end test of `index.html` + `js/app.js`:
  search flow, lightbox open/close, label-filter toggle, upload modal, label chip
  add/remove, upload validation, and a real upload against a mock backend (47 checks).

Both need a mock backend (Flask is not required — a small `http.server` script with
CORS implementing `GET /search` + `PUT /photos`); see "mock_backend" notes in the
session, or point them at your own backend by changing the API base.
