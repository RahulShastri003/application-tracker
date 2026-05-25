# Contributing

Thanks for helping improve Application Tracker. The project is intentionally small so new contributors can read it, run it, and change it without a long setup.

## License

Application Tracker is licensed under `AGPL-3.0-or-later`.

By contributing, you agree that your contribution will be released under the same license. Keep copyright, license, and citation files in forks and substantial derived work. The goal is simple: people can use and improve the app freely, while the original authorship remains visible and improvements stay open.

## Setup

Install Node.js 20 or newer, then run:

```sh
npm start
```

Open:

```text
http://localhost:4174
```

Run the syntax check before sharing changes:

```sh
npm run check
```

## Where Things Live

```text
index.html          Markup and form fields
app.css             Layout, themes, and responsive styling
app.js              Browser-side state, rendering, forms, import/export, and AI panel
server.mjs          Local API, saved files, AI settings, and provider calls
vendor/             Bundled browser libraries
data/               Local user data, ignored by Git
```

## Common Changes

Application types live in the `applicationTypes` object in `app.js`. Add a new key there to introduce another academic track or a future job category.

Each type can define:

- visible label
- field labels and placeholders
- type-specific fields
- section titles and helper text

Storage and upload behavior lives in `server.mjs`. Keep personal files out of Git; `data/` is ignored on purpose.

## Before a Pull Request

Please test:

- create a new entry
- edit, duplicate, and delete an entry
- expand and collapse a row
- upload, download, and remove a document
- export CSV
- import CSV and confirm existing entries remain
- ask the AI assistant a question and a follow-up
- switch light/dark theme
- refresh the browser and confirm saved entries remain

## Style

- Prefer clear names over clever abstractions.
- Keep dependencies low unless one clearly removes complexity.
- Keep UI behavior in `app.js`, styles in `app.css`, markup in `index.html`, and storage/API work in `server.mjs`.
- Add comments for decisions or tricky behavior, not for obvious line-by-line narration.

## Good First Issues

- Better full-backup export/import including uploaded files.
- Automated tests for CSV import/export.
- Browser checks on Firefox, Safari, Chrome, and Edge.
- More keyboard navigation.
- More AI providers and document-editing workflows.
