# CV Website with Admin Panel

A small full-stack web application that publishes a CV as a responsive website, exports it as an ATS-friendly PDF, and lets the owner edit everything through a secure admin panel. It is built with **Node.js and vanilla JavaScript only — no runtime dependencies and no build step.**

Author: **Kevin Da Costa Stateri** · [LinkedIn](https://www.linkedin.com/in/kevin-stateri) · kevin.stateri@gmail.com

> **Reading this as a recruiter or reviewer?** Skip to [Engineering practices](#engineering-practices) for the design decisions behind the code, and [Known limitations](#known-limitations-and-next-steps) for what was deliberately left out.

---

## Features

- Responsive CV website rendered from a single JSON document.
- **Download PDF**: the server renders a clean, single-column A4 CV using headless Chrome or Edge, caches it, and regenerates it when the CV changes. The browser's print dialog (`Ctrl/Cmd + P`) is the fallback and uses the same print stylesheet.
- **Admin panel** (`/admin`) to edit all content, add custom sections, reorder or hide sections, upload a photo, read contact messages and restore earlier versions.
- Contact form with server-side validation, spam protection and rate limiting.
- Generic by design: the content lives in [`data/cv.json`](data/cv.json), so the same app can publish anyone's CV.

## Getting started

**Requirements**

- [Node.js](https://nodejs.org) 18 or newer — check with `node -v`.
- Google Chrome, Microsoft Edge or Chromium — only needed for the PDF button.
- No `npm install` step: there are no dependencies.

```bash
git clone <repository-url> cv-site
cd cv-site
npm run setup-admin    # optional: create the admin login (see "Managing the admin")
npm start
```

Then open **http://localhost:3000** in your browser (admin panel: **http://localhost:3000/admin**). Stop the server with `Ctrl + C`.

### macOS

```bash
brew install node          # or use the installer from nodejs.org
npm start
```

Open http://localhost:3000. To use another port: `PORT=8080 npm start`, then open http://localhost:8080. Chrome and Edge are detected in `/Applications`.

### Linux (Debian/Ubuntu shown)

```bash
sudo apt update && sudo apt install -y nodejs npm chromium
npm start
```

Open http://localhost:3000. To use another port: `PORT=8080 npm start`, then open http://localhost:8080.

If your Node.js is older than 18, install a current version with [nvm](https://github.com/nvm-sh/nvm). On other distributions, install `chromium` or `google-chrome` with your package manager. If the browser is in an unusual location, set `CHROME_PATH=/path/to/browser`.

### Windows (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS     # then close and reopen PowerShell
npm start
```

Open http://localhost:3000. To use another port: `$env:PORT = 8080; npm start`, then open http://localhost:8080. In Command Prompt, use `set PORT=8080&& npm start`.

Chrome and Edge are detected in `Program Files` and `LocalAppData`. Otherwise set `$env:CHROME_PATH = "C:\path\to\chrome.exe"`.

## Managing the admin

The admin panel is **disabled until a login is created**, so a fresh clone is safe by default.

### Create or change the login

```bash
npm run setup-admin
```

It asks for a username and a password (at least 10 characters) and writes them to a `.env` file in the project folder. Only a scrypt **hash** of the password is stored, never the password itself. Restart the server, then sign in at http://localhost:3000/admin.

Non-interactive form, for scripts:

| Shell | Command |
|---|---|
| macOS / Linux | `ADMIN_USER=owner ADMIN_PASSWORD='a long passphrase' npm run setup-admin` |
| PowerShell | `$env:ADMIN_USER="owner"; $env:ADMIN_PASSWORD="a long passphrase"; npm run setup-admin` |

- **Forgotten password:** run `npm run setup-admin` again; it replaces the old login.
- **Switch the admin off:** delete the `ADMIN_USER` and `ADMIN_PASSWORD_HASH` lines from `.env` (or delete `.env`) and restart.
- **Sessions:** a sign-in lasts 8 hours and is held in memory, so restarting the server signs everyone out.
- **Lock-out:** five failed sign-ins within 15 minutes from one address block further attempts for 15 minutes.
- **HTTPS:** when serving over HTTPS, add `COOKIE_SECURE=1` to `.env` so the session cookie is marked `Secure`.
- `.env` is listed in `.gitignore` and must never be committed. [`.env.example`](.env.example) shows the format.

### What the admin can do

| Tab | Purpose |
|---|---|
| **Basics** | Name, title, contact details, LinkedIn, GitHub, right-to-work statement, profile photo |
| **Profile & highlights** | Summary paragraph and the headline numbers shown under the banner |
| **Experience, Skills, Projects, Education, Languages** | Add, edit, remove and reorder entries |
| **Custom sections** | Create any new block (certifications, volunteering, awards, references…) as a paragraph, bullet list or list of entries — no code needed |
| **Layout** | Show or hide sections, reorder them and rename headings, on both the website and the PDF |
| **Messages** | Read and delete messages sent through the contact form |
| **History & backup** | Restore any of the last 30 saved versions, or export and import the CV as JSON |

The photo appears on the website only; tick the option in **Basics** to include it in the PDF (not recommended for ATS).

### Adding a field to a built-in section

1. `lib/cvstore.js` — add it to `sanitize()` so it is validated and saved.
2. `public/admin.js` — add it to the matching list in `FIELDS` so it can be edited.
3. `public/app.js` — render it on the page (the PDF reuses the same output).

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/cv` | CV as JSON |
| GET | `/api/cv.pdf` | Download the CV as a PDF |
| POST | `/api/contact` | `{name, email, message}` → `201`, `422` or `429` |
| GET | `/api/health` | Liveness check |
| * | `/api/admin/*` | Authenticated admin API (session cookie + `X-CSRF-Token`); routes are listed at the top of `server.js` |

## Project structure

```
server.js          HTTP routing, public and admin API, PDF export
lib/auth.js        password hashing, sessions, CSRF, login rate limiting
lib/cvstore.js     CV validation (sanitize), atomic saves, version history
lib/messages.js    contact-form message storage
lib/env.js         minimal .env loader
scripts/           setup-admin (creates .env)
data/cv.json       CV content — the single source of truth
public/            website (index.html, app.js, styles.css) and admin (admin.*)
test/              automated tests
```

## Engineering practices

### Security

| Practice | Implementation |
|---|---|
| Passwords are never stored | scrypt with a random salt per password; comparison uses `crypto.timingSafeEqual` ([`lib/auth.js`](lib/auth.js)) |
| Safe by default | Admin endpoints return `503` until a login is configured; no default credentials exist |
| Session handling | Random 256-bit session IDs; `HttpOnly`, `SameSite=Strict` cookie (`Secure` over HTTPS); 8-hour expiry; server-side logout |
| CSRF protection | Every state-changing admin request must carry a per-session `X-CSRF-Token` header |
| Brute-force protection | Sign-in lock-out after five failures in 15 minutes; separate rate limit on the contact form |
| Input validation at the boundary | `sanitize()` whitelists known fields, trims and length-caps every string, limits array sizes and drops unknown keys, so malformed or hostile JSON cannot reach storage |
| XSS prevention | The front end builds the DOM with `textContent`, never `innerHTML`; links are limited to `http(s):`, `mailto:` and `tel:` |
| Safe file uploads | Type is checked against the file's magic bytes, not just the header; 2 MB limit; fixed filenames, so no user-controlled paths |
| Defence in depth | `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `Cache-Control: no-store` on API responses; path-traversal-safe static serving |
| Secrets stay out of Git | `.env`, uploads, messages and version history are all in `.gitignore` |

### Reliability and data integrity

- **Atomic writes:** the CV is written to a temporary file and renamed, so a crash can never leave a half-written `cv.json`.
- **Version history:** each save snapshots the previous version and prunes to the latest 30; restoring is itself a safe, reversible save.
- **PDF generation:** concurrent requests share one job, a temporary browser profile is created and removed each time, and the cached file is invalidated automatically when the CV changes.
- **Graceful degradation:** if no Chrome or Edge is found, the API returns a clear message and the print stylesheet still produces the same PDF.

### Design and maintainability

- **No runtime dependencies:** a small attack surface, nothing to audit or update, and it runs identically on macOS, Linux and Windows.
- **Single source of truth:** one JSON document drives the website, the PDF and the admin editor.
- **Separation of concerns:** a thin HTTP layer in `server.js`, with authentication, storage and validation in separate modules under `lib/`.
- **Schema-driven admin UI:** forms are generated from field definitions, so adding a field is a three-line change rather than new UI code.
- **Extensible without code:** custom sections cover new content types, so the data model does not need to change for every new requirement.

### Front end, accessibility and ATS

- Semantic HTML, a responsive layout from phone to desktop, and `prefers-reduced-motion` support.
- A dedicated print stylesheet produces a **single-column, text-based PDF** in a logical reading order, which applicant tracking systems parse reliably.
- Server-rendered PDF text is selectable and searchable, not an image.

### Testing

Run the suite with `npm test` (Node's built-in test runner). It covers password hashing, input validation, link-scheme rejection, unique and complete layout handling, and the GitHub field. The admin API flows (login, CSRF, saving, uploads, version history and lock-out) were additionally checked end to end against a running server.

## Known limitations and next steps

Stating these openly is deliberate; each has a clear upgrade path.

- **Sessions are in memory:** they reset on restart and do not scale across several instances. A shared store such as Redis would fix this.
- **Single admin account and file-based storage:** appropriate for one personal site; a database and multiple users would suit a larger deployment.
- **No TLS in the app:** run it behind a reverse proxy (Nginx, Caddy) that terminates HTTPS, and set `COOKIE_SECURE=1`.
- **The contact form does not send email:** messages are stored and read in the admin. SMTP or a transactional email service would be the next step.
- **Test coverage:** unit tests cover validation and authentication; HTTP-level integration tests would be a worthwhile addition.

## Data and privacy

Contact-form messages, uploaded photos and version history are stored locally under `data/` and excluded from Git. If you publish this repository, remember that `data/cv.json` contains the CV's contact details.

## Licence

MIT — see [LICENSE](LICENSE).
