# Architecture

Application Tracker is a browser app backed by a small local Node.js server. The browser gives the interface; the server saves entries, uploaded files, and AI settings into a local data folder.

## Runtime

```text
Browser
  index.html
  app.css
  app.js
    |
    | HTTP
    v
Local Node.js server
  server.mjs
    |
    | files
    v
Local data folder
  data/applications.json
  data/ai-settings.json
  data/uploads/
  data/defaults/
```

## Frontend

`index.html` holds the fixed page structure: top bar, filters, application table, AI panel, editor form, and upload controls.

`app.css` holds the visual system: layout, themes, table rows, form sections, status badges, document rows, and responsive rules.

`app.js` owns browser behavior:

- dashboard state and rendering
- application type configuration
- editor form reading and writing
- import/export
- upload UI
- AI chat panel and local fallback answers
- migration from older browser-only storage

## Backend

`server.mjs` uses Node.js built-in modules only. It serves the app files and provides the local API:

- `GET /api/state` reads saved tracker data
- `PUT /api/state` saves entries and reusable document metadata
- `POST /api/upload` writes uploaded files to the data folder
- `GET /api/ai/settings` returns public AI settings without exposing the saved key
- `PUT /api/ai/settings` saves AI provider settings locally
- `POST /api/ai/ask` calls the user-configured provider
- `GET /uploads/*` downloads saved documents

## Data

Entries are stored as plain JSON so users can inspect or repair them by hand:

```text
data/applications.json
```

Uploaded files are stored as normal files:

```text
data/uploads/<entry-key-or-id>/
data/defaults/<document-type>/
```

The JSON stores document metadata and URLs, not large file blobs.

AI settings are stored here:

```text
data/ai-settings.json
```

That file can contain an API key, so the whole `data/` folder is ignored by Git.

## Extension Points

Application tracks are configured in `applicationTypes` inside `app.js`. Current tracks are:

- `postdoc`
- `phd`
- `fellowship`
- `grant`

To add another track, add a new key with labels, placeholders, section titles, and type-specific fields. The editor renders those fields automatically and saves their values in `typeDetails`.

Future improvements that fit this structure:

- full backup export/import with uploaded files
- automated browser tests
- richer AI provider support
- direct document editing after AI suggestions
- job or funding call search integrations
- packaged desktop builds for users who do not want to run Node.js manually
