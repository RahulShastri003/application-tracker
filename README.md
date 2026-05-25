# Application Tracker

## About

Application Tracker is a local app for tracking postdoc, PhD, fellowship, and grant applications. It keeps deadlines, status, preparation notes, contacts, uploaded documents, and AI-assistance in one place. The app runs in the browser, but the real data is saved in local folders on the user's computer. Refreshing the browser or reopening the app reads the same saved data.

Future contributors can add other tracks, such as faculty jobs or industry jobs, by extending the `applicationTypes` configuration in `app.js`. The shared fields stay the same, while each application type can add its own fields.

Project author: Rahul Shastri.

License and citation:

- Code is licensed under `AGPL-3.0-or-later`.
- Forks and hosted modified versions must keep the same open-source license and provide source code to users.
- Copyright notices and attribution to Rahul Shastri must be preserved.
- Citation information is provided in [CITATION.cff](./CITATION.cff).

## How to Run

Requirements:

- Node.js 20 or newer
- A modern browser: Chrome, Edge, Firefox, or Safari

Easy launch:

```text
macOS:   double-click start-tracker.command
Windows: double-click start-tracker.bat
Linux:   run ./start-tracker.sh
```

Keep the terminal window open while using the tracker. Closing it stops the local server, but saved entries and files remain in the `data` folder.

Terminal launch:

```sh
npm start
```

Then open:

```text
http://localhost:4174
```

The full app must run on the user's own computer because uploaded documents are stored in local folders.

Browser demo:

```text
https://rahulshastri003.github.io/application-tracker/
```

The demo runs without the local Node server. It is useful for trying the interface, but entries stay in that browser and uploaded files are not saved into local folders.

## Project Structure

```text
index.html          Page structure
app.css             Styling, themes, and responsive layout
app.js              Frontend behavior, forms, rendering, import/export, and AI panel
server.mjs          Local backend API, file storage, and AI provider calls
vendor/             Bundled browser libraries
data/               Local user data, ignored by Git
docs/               Architecture notes
.github/workflows/  GitHub Actions checks and Pages demo deployment
LICENSE             AGPL-3.0-or-later license text
NOTICE              Authorship and attribution notice
CITATION.cff        Citation metadata shown by GitHub
```

The app creates this local folder when it runs:

```text
data/
  applications.json
  ai-settings.json
  uploads/
  defaults/
```

- `data/applications.json` stores application entries and document metadata.
- `data/uploads/` stores documents attached to specific applications.
- `data/defaults/` stores reusable files, such as a master CV.
- `data/ai-settings.json` stores local AI settings and may contain an API key.

Import and export:

- Export creates a CSV file for reading or analysis.
- Import accepts CSV or JSON and adds entries to the current tracker.
- Import does not replace existing entries.
- If an imported short key already exists, the app adds a suffix such as `-2`.

AI assistant:

- Built-in local mode answers simple tracker questions without sending data anywhere.
- Connected AI mode sends tracker context to the provider configured by the user.
- No external provider is selected by default.
- Users can connect Ollama, Gemini API, Groq, OpenRouter, Mistral, or a custom OpenAI-compatible endpoint with their own settings.
- The assistant can use application details and readable text extracted from PDF/TXT uploads. It suggests edits and drafts text, but it does not directly overwrite uploaded documents.

Custom data folder:

```sh
TRACKER_DATA_DIR="/path/to/my-tracker-data" npm start
```

Windows PowerShell:

```powershell
$env:TRACKER_DATA_DIR="C:\path\to\my-tracker-data"; npm start
```

To move a personal tracker to another computer, copy the project folder with `data`. To share a fresh public copy, leave `data` out.

## Contributors

Contributions are welcome. By contributing, you agree that your contribution is licensed under `AGPL-3.0-or-later` with the rest of the project.

Run checks before opening a pull request:

```sh
npm run check
```

Good manual checks:

- create, edit, duplicate, and delete an entry
- expand and collapse application rows
- upload, download, and remove a document
- export CSV and import it into an existing tracker
- ask the AI assistant a first question and a follow-up question
- refresh the browser and confirm saved data remains
- switch between light and dark theme

Start with `app.js` when adding application types. Start with `server.mjs` when changing local storage, uploads, or AI provider calls. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for more detail.

Third-party code notices are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Privacy

This is a local app. Application details and uploaded files stay on the user's computer unless the user copies, exports, syncs, or shares the folder.

Do not commit `data/` to GitHub if it contains applications, CVs, proposals, letters, or API keys. The folder is ignored by Git for that reason.
