# Kevin Da Costa Stateri — CV Website

A polished, responsive CV website with a small Node.js back-end, built for UK recruiters and hiring managers.

**Features**

- Modern responsive front-end (vanilla HTML/CSS/JS, no build step), dark hero + clean content sections
- **Download PDF** button — server-side export of an ATS-friendly A4 CV via headless Chrome/Edge (cached, regenerated when `data/cv.json` changes). Falls back to the browser print dialog (`Cmd+P`) which uses the same print stylesheet
- REST API: `GET /api/cv`, `POST /api/contact`, `GET /api/cv.pdf`, `GET /api/health`
- Contact form with server-side validation, honeypot spam trap, rate limiting; messages stored in `data/messages.jsonl`
- Security headers (CSP, `nosniff`, frame denial), path-traversal-safe static serving, XSS-safe rendering (`textContent` only)
- **Zero npm dependencies** — only Node.js 18+

## Run locally (macOS)

```bash
cd kevin
npm start            # http://localhost:3000
PORT=8080 npm start  # custom port
```

PDF export needs Google Chrome, Microsoft Edge or Chromium installed (auto-detected). Otherwise set `CHROME_PATH=/path/to/browser`.

## Edit the CV

All content lives in [`data/cv.json`](data/cv.json). Edit it and refresh — the page and PDF update automatically.

## Project structure

```
server.js        HTTP server + API + PDF export
data/cv.json     CV content (single source of truth)
public/          index.html, styles.css, app.js, assets/
```

## API

| Method | Path          | Description                              |
|--------|---------------|------------------------------------------|
| GET    | `/api/cv`     | CV as JSON                               |
| GET    | `/api/cv.pdf` | Download CV as PDF                       |
| POST   | `/api/contact`| `{name, email, message}` → 201 / 422 / 429 |
| GET    | `/api/health` | Liveness check                           |

## License

MIT
