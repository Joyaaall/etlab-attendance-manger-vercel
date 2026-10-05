# Rollcall frontend: design and behaviour

## Composition

Primary surface: Monitor. Secondary surfaces: Configure (weekly timetable) and Compare (leave options). The authenticated app prioritises aligned per-subject numbers and a dense weekly schedule, not a marketing hero or decorative metric cards.

## Online references actually reviewed

- Wise's live design site, https://wise.design/: restrained nature-based contrast, strong type, clear control hierarchy. The originally attempted `/foundations/colour` URL redirected to a 404; it was not used as a valid source.
- Cal.com's live site, https://cal.com/: legible calendar density, explicit selection states, compact schedule controls. This informed the interaction posture, not a reproduction of their brand or layout.

The result is an original academic/editorial interface: paper surfaces, deep forest-green structural panels, a muted lime action accent, and thin register-like rules. There are no gradients, glass panels, emoji tiles, fabricated live metrics, or stock-photo sections.

## Tokens and assets

- Paper: `#f5f4ed`; surface: `#fffef9`; ink: `#202c26`.
- Forest: `#173f35`; lime: `#d6e88b`; ochre: `#e8b857`.
- Warning/error: text `#a44330`, surface `#faeae2`.
- UI/body: DM Sans; editorial headings: Fraunces; exact-hour figures use tabular numerals.
- Fonts are self-hosted from Google's open-source font repository. Their OFL licenses are stored beside the font files in `public/static/fonts/`. The app makes no external font/CDN requests.
- Motion: short entrance, progress-bar updates, subtle button press feedback and a loading line. All non-essential motion respects `prefers-reduced-motion`.

## API and session behaviour

The frontend is served at `/` by the same Flask application as `/api/*`. Username/password login uses POST `/api/login`. The returned Etlab session value is kept only in a JavaScript closure/controller state; it is never written to localStorage, sessionStorage, URLs, or cookies. Password inputs are cleared when the request is sent. Refreshing the page signs the user out. A 401 clears the local session and returns to sign-in.

`/api/semesters` discovers the current and available supported semester IDs from the account's Etlab attendance form. If discovery fails, the user chooses a semester manually; the UI does not assume semester 5. Missing attendance disables recommendations. Refresh failures do not reuse stale subject-hour budgets.

Only the custom timetable and target preferences persist in local browser storage, scoped to account identifier and semester. Draft changes are distinct from the saved week used by the planner. Another account/semester never silently inherits a timetable.

Subject labels prefer attendance-header metadata and are supplemented asynchronously from `/api/subject-names`, which reads present/absent entries for the requested semester in the selected and previous available reporting months. Timetable labels remain a fallback. This handles labs/electives absent from code-prefixed timetable exports without inventing course-name mappings. Late responses are discarded after semester/session changes. Missing metadata leaves the explicit unnamed fallback; zero-hour counts remain unknown regardless of label availability.

## Calculator assumptions

The initial target is 75%, a configurable calculator default, not a verified college policy. Each timetable slot is one attendance hour. Unknown/unassigned slots and subjects without valid hour counts block the affected leave option. Explicit free slots are ignored. Repeated subject/lab periods consume repeated hours. Overall attendance never substitutes for per-subject eligibility.

The planner offers full-day and after-lunch leave for a 14-day window; the lunch boundary and number of periods are configurable. Multiple selected days share each subject's budget. It conservatively adds missed periods to conducted hours and does not credit assumed attendance between selected dates. It cannot know holidays, special schedules, institutional rounding, required labs, exemptions, or permission rules. Its recommendation is a calculation, not permission to miss class.

## Test discipline

Python tests cover HTML serving, security headers, semester discovery and existing API regressions. Node tests exercise the API client and exact-hour calculator. Playwright runs the real frontend against synthetic, route-intercepted API responses on a private loopback test server. These fixtures never represent a successful real-account login. Browser screenshots from those tests must be described as synthetic test data.
