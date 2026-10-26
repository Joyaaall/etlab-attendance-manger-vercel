# Frontend architecture and behaviour

The frontend is a server-rendered application shell enhanced by vanilla JavaScript. Its visual system is documented in [`../DESIGN.md`](../DESIGN.md).

## Application surfaces

The authenticated workspace has three task views:

1. **Attendance** shows each subject's recorded hours, percentage, and available margin against the selected target.
2. **Timetable** imports the Etlab week or lets the student maintain a local version.
3. **Leave plan** compares full-day and after-lunch options for the next 14 days against the saved timetable and latest attendance snapshot.

Login and onboarding use the same Margin Club paper, cobalt, butter, tangerine, and ink system as the workspace. Mobile attendance rows become subject cards so the core results remain visible without horizontal scrolling.

## Session and local storage

The frontend is served at `/` by the same Flask application as `/api/*`. Login uses `POST /api/login`. The returned Etlab session token stays in JavaScript memory and is never written to cookies, URLs, `localStorage`, or `sessionStorage`. Password fields are cleared when the request is sent. Refreshing the page or signing out clears the session, and a `401` response returns the interface to sign-in.

Only the student's custom timetable and attendance target persist in browser storage. Both are scoped to the current account and semester. Draft timetable edits remain separate from the saved week used by the leave planner.

## Data loading

`/api/semesters` discovers supported semesters from the student's Etlab account. If discovery fails, the interface asks the student to choose one rather than assuming a semester.

Subject labels prefer attendance metadata and are supplemented by `/api/subject-names`. Timetable labels are a fallback. Late responses are discarded after a semester or session change. Missing hours remain unknown even if a label is available.

Refresh failures do not reuse old subject budgets. Missing attendance or timetable data blocks affected recommendations instead of producing an optimistic result.

## Calculator assumptions

The initial target is 75%, but it is only a calculator setting. Every timetable slot counts as one attendance hour. Repeated periods consume repeated hours, free periods are ignored, and unknown slots block the affected option.

The planner compares full-day and after-lunch leave over 14 days. Multiple selected dates share each subject's available margin. It adds missed periods to conducted hours and does not assume that the student attends classes between selected dates.

The planner cannot know holidays, special schedules, institutional rounding, mandatory labs, exemptions, or permission rules. Its result is an estimate, not approval to miss class.

## Assets and deployment

DM Sans and Fraunces are self-hosted under `public/static/fonts/` with their OFL license files. The browser does not request fonts from an external CDN.

Vercel serves `public/static/` at `/static/*`; the production Flask app leaves static delivery to Vercel. `dev.py` enables Flask static serving for local development and browser tests.

## Test coverage

- Python tests cover API behaviour, portal restrictions, HTML serving, security headers, local static serving, and Vercel packaging.
- Node tests cover the API client and attendance calculations.
- Playwright tests run the real frontend against synthetic, intercepted Etlab responses at desktop and mobile sizes.
- GitHub Actions runs all three suites on every push and pull request.

Browser fixtures and screenshots contain synthetic data and must not be presented as real student records.
