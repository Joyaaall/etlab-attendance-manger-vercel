# Attendance Manager

A privacy-conscious Etlab attendance dashboard and leave-planning tool, built with Flask and deployed as a Vercel Python Function.

Attendance Manager helps students understand their recorded attendance subject by subject, build a weekly timetable, and estimate whether a full-day or afternoon leave would keep each subject above a chosen target.

> [!IMPORTANT]
> This is an independent, unofficial project. It is not affiliated with Etlab, your college, or university. Leave calculations are estimates—not permission to miss classes. Always verify institutional rules, holidays, timetable changes, labs, and official records.

## Features

- Connects to supported HTTPS Etlab portals under `etlab.app` and `etlab.in`
- Displays per-subject present hours, total hours, and attendance percentage
- Discovers available semesters from the student's Etlab account
- Calculates how many additional hours can be missed—or must be attended—for a selected target
- Imports an Etlab timetable or lets the student build one manually
- Evaluates full-day and after-lunch leave options across the next 14 days
- Supports cumulative planning across multiple selected dates
- Includes a responsive, keyboard-accessible interface with reduced-motion support

## Privacy and security

- Etlab passwords are forwarded only to the validated portal selected by the user and are never stored by the application.
- The signed Etlab session token is kept in browser memory, not cookies, URLs, `localStorage`, or `sessionStorage`.
- Refreshing the page or signing out clears the active session.
- Only timetable and attendance-target preferences are stored locally in the browser, scoped by account and semester.
- Portal URLs are restricted to validated HTTPS subdomains of `etlab.app` and `etlab.in`.
- API and document responses use no-store and browser security headers.

Review the implementation before deploying it for other users. Public deployments should add rate limiting or firewall protection to login-related endpoints.

## Tech stack

- Python 3.12
- Flask 3
- Beautiful Soup and Requests
- Vanilla JavaScript, HTML, and CSS
- Vercel Python Functions and Vercel static assets
- Python `unittest`, Node's built-in test runner, and Playwright

## Project structure

```text
.
├── app/
│   ├── docs/             # Flasgger/OpenAPI configuration
│   ├── routes/           # Flask API and frontend routes
│   ├── templates/        # Application shell
│   └── utils/            # Portal validation and token helpers
├── docs/                 # Design and behaviour notes
├── public/static/        # Browser JavaScript, CSS, fonts, and icon
├── tests/                # Python, Node, and Playwright tests
├── config.py             # Runtime configuration
├── index.py              # Vercel/Flask entrypoint
├── requirements.txt      # Python dependencies
└── vercel.json           # Vercel function configuration
```

## Local setup

### Prerequisites

- Python 3.12
- Node.js 20 or newer for JavaScript tests
- Vercel CLI for the complete frontend development environment

### Install Python dependencies

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Configure the environment

```bash
cp .env.example .env
python3.12 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the generated value into `.env` as `ETLAB_TOKEN_SECRET`. Never commit `.env` or use the example's empty value in production.

Available variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ETLAB_TOKEN_SECRET` | Required on Vercel | Random per local process | Signs portal-bound session tokens |
| `ETLAB_BASE_URL` | No | `https://asiet.etlab.app` | Legacy default portal |
| `ETLAB_COOKIE_KEY` | No | `ASIETSESSIONID` | Legacy default session-cookie name |
| `ETLAB_TOKEN_MAX_AGE` | No | `43200` | Signed-session lifetime in seconds |

### Run locally

Flask intentionally does not serve files from `public/`; Vercel serves them at `/static/*`. Use the Vercel development server for the complete application:

```bash
npm install --global vercel
vercel dev
```

## Tests

Run the Python API, parser, frontend, and packaging tests:

```bash
ETLAB_TOKEN_SECRET=test-only-secret-at-least-32-characters \
  .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Run the dependency-free JavaScript unit tests:

```bash
npm run test:unit
```

Run the browser tests after installing Playwright and starting Vercel on port `5001`:

```bash
npm install
npx playwright install chromium
vercel dev --listen 5001
```

Then, in another terminal:

```bash
npm run test:browser
```

Browser tests use synthetic, intercepted Etlab responses and do not require a real student account.

## Deploy to Vercel

1. Import the GitHub repository into Vercel or run `vercel link` from this directory.
2. Generate a stable secret:

   ```bash
   python3.12 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

3. Add it as `ETLAB_TOKEN_SECRET` for Production and Preview environments.
4. Deploy with `vercel --prod`.

The secret must remain stable across serverless instances. The application refuses to start on Vercel when it is missing.

## Limitations

- The planner cannot know holidays, special timetables, attendance exemptions, mandatory labs, or institution-specific rounding rules.
- It does not credit future classes that the student expects to attend.
- Etlab may change its HTML structure or block requests from serverless data-centre IP addresses.
- Support is limited to validated Etlab portal domains and the page structures covered by this project's parsers and tests.

## Contributing

Issues and pull requests are welcome. Do not include real credentials, session tokens, student records, or screenshots containing personal data in bug reports or test fixtures.

## License

Licensed under the GNU General Public License v3.0. See `LICENSE.md`.