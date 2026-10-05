import { apiFetch, ApiError } from './api-client.mjs';
import { calculateAttendance, evaluateLeave, buildDates, importTimetable } from './attendance-math.mjs';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const $ = id => document.getElementById(id);
const titleCase = value => value.charAt(0).toUpperCase() + value.slice(1);
const percent = value => Number.isFinite(value) ? `${value.toFixed(1).replace(/\.0$/, '')}%` : '—';
const count = value => typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
const emptyWeek = periods => Object.fromEntries(DAYS.map(day => [day, Array(periods).fill('?')]));
const cloneWeek = week => Object.fromEntries(DAYS.map(day => [day, [...week[day]]]));
const localDate = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ONBOARDING_STEPS = [
  { label: 'COLLEGE', title: 'Start with your college portal.', description: 'Paste the Etlab link your college uses. With or without https:// works.' },
  { label: 'PRIVATE', title: 'Sign in without leaving credentials behind.', description: 'Your password is used only for login. The Etlab session stays in memory and clears when you refresh or sign out.' },
  { label: 'REGISTER', title: 'See the real margin for every subject.', description: 'Attendance Manager reads recorded hours and calculates exactly how many additional periods each subject can afford.' },
  { label: 'PLANNER', title: 'Turn your timetable into a leave plan.', description: 'Set or import your week, then compare complete-day and after-lunch leave using one shared attendance budget.' },
];
const state = {
  token: null, portalUrl: null, portalHost: null, profile: null, semester: null, target: 75, subjects: Object.create(null), names: Object.create(null),
  imported: null, snapshot: null, dataAvailable: false, draft: emptyWeek(8), periods: 8, lunch: 4,
  saved: null, dirty: false, view: 'attendance', selections: new Map(), generation: 0,
  requests: new AbortController(), loading: false,
};
let toastTimer;
let onboardingStep = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function announce(message) { $('announcer').textContent = message; }
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function notice(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
function renderOnboarding() {
  const step = ONBOARDING_STEPS[onboardingStep];
  $('onboarding-progress').textContent = `${onboardingStep + 1} / ${ONBOARDING_STEPS.length}`;
  $('onboarding-title').textContent = step.title;
  $('onboarding-description').textContent = step.description;
  $('onboarding-visual-label').textContent = step.label;
  $('onboarding-meter-fill').style.width = `${(onboardingStep + 1) / ONBOARDING_STEPS.length * 100}%`;
  $('onboarding-back').hidden = onboardingStep === 0;
  $('onboarding-next').firstChild.textContent = onboardingStep === ONBOARDING_STEPS.length - 1 ? 'Start exploring ' : 'Next ';
}
function closeOnboarding() {
  const dialog = $('onboarding-dialog');
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}
function key(suffix = '') {
  return `attendance-manager.v2.${encodeURIComponent(state.portalHost || '')}.${encodeURIComponent(state.profile?.admission_no || state.profile?.university_roll_no || '')}.${state.semester}${suffix}`;
}
function setDirty(value = true) {
  state.dirty = value;
  $('timetable-save-status').classList.toggle('dirty', value);
  $('timetable-save-status').textContent = value ? 'Unsaved changes — the planner still uses your last saved week.' : state.saved ? 'Saved in this browser · account and semester specific' : 'Not saved yet — unassigned slots are not free periods.';
}
function showView(view) {
  if (!['attendance', 'timetable', 'planner'].includes(view)) return;
  state.view = view;
  for (const name of ['attendance', 'timetable', 'planner']) $(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('.app-nav [data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (view === 'planner') renderPlanner();
  announce(`${titleCase(view)} view opened.`);
}
function setLoading(value) {
  state.loading = value;
  $('attendance-loading').hidden = !value;
  $('refresh-button').disabled = value;
  $('semester').disabled = value;
  $('refresh-button').textContent = value ? 'Reading Etlab…' : '↻ Refresh';
}
function showPortalStep() {
  $('portal-step').hidden = false;
  $('credentials-step').hidden = true;
  notice('portal-error');
  notice('login-error');
}
function showCredentialsStep() {
  $('portal-step').hidden = true;
  $('credentials-step').hidden = false;
  $('selected-portal-host').textContent = state.portalHost || 'Selected Etlab portal';
  notice('portal-error');
  notice('login-error');
}
function resetSession(message = '') {
  state.generation += 1;
  state.requests.abort();
  state.requests = new AbortController();
  state.token = null;
  state.profile = null;
  state.subjects = Object.create(null);
  state.names = Object.create(null);
  state.imported = null;
  state.selections.clear();
  state.snapshot = null;
  state.dataAvailable = false;
  state.saved = null;
  state.draft = emptyWeek(8);
  state.dirty = false;
  $('password').value = '';
  $('password').type = 'password';
  $('toggle-password').textContent = 'Show';
  $('toggle-password').setAttribute('aria-pressed', 'false');
  $('toggle-password').setAttribute('aria-label', 'Show password');
  $('workspace').hidden = true;
  $('login-screen').hidden = false;
  if (state.portalUrl) showCredentialsStep(); else showPortalStep();
  $('subject-rows').replaceChildren();
  $('timetable-body').replaceChildren();
  $('planner-days').replaceChildren();
  $('selected-plan').replaceChildren();
  $('plan-impact').replaceChildren();
  notice('login-error', message);
  $('login-submit').disabled = false;
  $('login-submit').firstElementChild.textContent = 'Open my dashboard';
  announce(message || 'Signed out.');
}
async function request(path, options = {}) {
  try {
    return await apiFetch(path, { token: state.token, signal: state.requests.signal, ...options });
  } catch (error) {
    if (error.status === 401 && state.token) resetSession('Your Etlab session has expired. Please sign in again.');
    throw error;
  }
}
function renderAccount() {
  const profile = state.profile || {};
  const name = profile.name || 'Student';
  $('account-initials').textContent = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  $('profile-line').textContent = `${name} / ${profile.university_roll_no || profile.admission_no || state.portalHost || 'ETLAB'}`;
  $('workspace-portal-tag').textContent = (state.portalHost || 'ETLAB').split('.')[0].toUpperCase().slice(0, 16);
  $('workspace-footer-portal').textContent = `ATTENDANCE MANAGER / ${state.portalHost || 'ETLAB'}`;
  $('greeting').replaceChildren(document.createTextNode('Your attendance, '), node('em', '', 'at a glance.'));
}
function updateSubjectNames() {
  state.names = Object.create(null);
  for (const [code, subject] of Object.entries(state.subjects)) {
    if (subject.name) state.names[code] = subject.name;
  }
  const codes = Object.keys(state.subjects).sort((a, b) => b.length - a.length);
  for (const day of Object.values(state.imported || {})) {
    for (const period of Object.values(day || {})) {
      if (typeof period?.name !== 'string') continue;
      const raw = period.name;
      const code = codes.find(candidate => raw === candidate || raw.startsWith(`${candidate} - `));
      if (code && !state.names[code] && raw.startsWith(`${code} - `)) {
        state.names[code] = raw.slice(code.length + 3).replace(/<[^>]*>/g, ' ').replace(/\s*\[[^\]]*\].*$/, '').trim();
      }
    }
  }
}
async function enrichSubjectNames(generation, semester) {
  try {
    const data = await request(`/api/subject-names?semester=${encodeURIComponent(semester)}`);
    if (generation !== state.generation || !state.token || semester !== state.semester) return;
    for (const [code, name] of Object.entries(data.subject_names || {})) {
      if (Object.hasOwn(state.subjects, code) && !state.subjects[code].name && typeof name === 'string' && name.trim()) {
        state.subjects[code].name = name.trim();
      }
    }
    updateSubjectNames();
    renderAttendance();
    renderTimetable();
    renderPlanner();
  } catch {
    // Optional labels never invalidate successfully loaded attendance counts.
  }
}
function restoreTimetable() {
  state.saved = null;
  state.periods = 8;
  state.lunch = 4;
  state.draft = emptyWeek(8);
  state.selections.clear();
  try {
    const stored = JSON.parse(localStorage.getItem(key('.timetable')) || 'null');
    if (stored && Number.isInteger(stored.periods) && stored.periods >= 4 && stored.periods <= 12 && Number.isInteger(stored.lunch) && stored.lunch >= 1 && stored.lunch < stored.periods && DAYS.every(day => Array.isArray(stored.week?.[day]) && stored.week[day].length === stored.periods && stored.week[day].every(code => typeof code === 'string' && code.length < 100))) {
      state.periods = stored.periods;
      state.lunch = stored.lunch;
      state.draft = cloneWeek(stored.week);
      state.saved = { periods: stored.periods, lunch: stored.lunch, week: cloneWeek(stored.week) };
    }
    const preferences = JSON.parse(localStorage.getItem(key('.preferences')) || 'null');
    if (preferences && validTarget(preferences.target)) state.target = preferences.target;
  } catch { toast('Saved settings could not be read. Nothing has been assumed about your timetable.'); }
  $('target').value = state.target;
  $('period-count').value = state.periods;
  setDirty(false);
  renderTimetable();
}
function validTarget(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}
function renderAttendance() {
  const entries = Object.entries(state.subjects);
  const search = $('subject-search').value.trim().toLowerCase();
  const filter = $('subject-filter').value;
  let above = 0;
  let below = 0;
  let present = 0;
  let total = 0;
  let displayed = 0;
  const fragment = document.createDocumentFragment();
  for (const [code, subject] of entries) {
    const result = calculateAttendance(subject.present, subject.total, state.target);
    if (result.valid) {
      if (result.status === 'below') below += 1; else above += 1;
      present += subject.present;
      total += subject.total;
    }
    if (search && !`${code} ${state.names[code] || ''}`.toLowerCase().includes(search)) continue;
    if (filter === 'below' && result.status !== 'below') continue;
    if (filter === 'available' && !(result.valid && result.skipHours > 0)) continue;
    displayed += 1;
    const row = node('tr', 'subject-row');
    row.dataset.subject = code;
    const subjectCell = node('td');
    subjectCell.append(node('span', 'subject-code', code), node('span', 'subject-name', state.names[code] || 'Subject name not supplied by this register'));
    const attendanceCell = node('td');
    attendanceCell.append(node('div', 'percentage-value', percent(result.percentage)));
    const bar = node('div', `percentage-bar ${result.status}`);
    bar.style.setProperty('--progress', `${result.valid ? result.percentage : 0}%`);
    bar.style.setProperty('--target', `${state.target}%`);
    bar.setAttribute('aria-hidden', 'true');
    bar.append(node('span', 'bar-fill'), node('span', 'target-tick'));
    attendanceCell.append(bar);
    const hoursCell = node('td');
    const hours = node('span', 'hours-value', Number.isSafeInteger(subject.present) && Number.isSafeInteger(subject.total) ? `${subject.present} / ${subject.total}` : '—');
    hours.append(node('small', '', 'present / conducted'));
    hoursCell.append(hours);
    const budgetCell = node('td');
    let budget;
    let description;
    if (!result.valid) { budget = 'Unknown'; description = 'No valid recorded hours yet'; }
    else if (result.status === 'below') {
      budget = result.attendHours === null ? 'Cannot reach 100%' : `Attend ${result.attendHours} ${result.attendHours === 1 ? 'hour' : 'hours'}`;
      description = result.attendHours === null ? 'Previous absences remain in the denominator' : `Consecutive attended hours to reach ${state.target}%`;
    } else {
      budget = `${result.skipHours} ${result.skipHours === 1 ? 'hour' : 'hours'} to spare`;
      description = result.skipHours ? 'Maximum additional missed periods' : 'No additional missed periods at this target';
    }
    budgetCell.append(node('span', `budget-badge ${result.status}`, budget), node('span', 'budget-description', description));
    row.append(subjectCell, attendanceCell, hoursCell, budgetCell);
    fragment.append(row);
  }
  $('subject-rows').replaceChildren(fragment);
  $('subjects-empty').hidden = state.loading || displayed !== 0;
  $('subjects-empty-message').textContent = entries.length ? 'No subjects match your search or filter.' : 'Choose a semester or refresh your Etlab data. Leave recommendations stay blocked until attendance is available.';
  $('subject-count').textContent = `${entries.length} SUBJECT${entries.length === 1 ? '' : 'S'}`;
  $('subjects-above').textContent = entries.length ? above : '—';
  $('subjects-below').textContent = entries.length ? below : '—';
  $('recorded-hours').textContent = total || '—';
  $('overall-percentage').textContent = total ? percent(present / total * 100) : '—';
}
async function loadSemester({ keepTimetable = false } = {}) {
  if (!state.semester || !state.token) return;
  const generation = ++state.generation;
  const requestedSemester = state.semester;
  setLoading(true);
  state.dataAvailable = false;
  state.subjects = Object.create(null);
  if (!keepTimetable) restoreTimetable();
  renderAttendance();
  renderPlanner();
  notice('workspace-error');
  $('snapshot-line').textContent = 'Reading your latest recorded hours…';
  try {
    const data = await request(`/api/attendance?semester=${encodeURIComponent(requestedSemester)}`);
    if (generation !== state.generation || !state.token) return;
    for (const [code, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'present_hours' in value && 'total_hours' in value) {
        state.subjects[code] = {
          present: count(value.present_hours), total: count(value.total_hours),
          name: typeof value.subject_name === 'string' ? value.subject_name.trim() : '',
        };
      }
    }
    state.dataAvailable = Object.keys(state.subjects).length > 0;
    state.snapshot = new Date();
    updateSubjectNames();
    renderAttendance();
    renderTimetable();
    renderPlanner();
    const time = state.snapshot.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('snapshot-line').textContent = `Semester ${state.semester} · Etlab snapshot refreshed at ${time}. Future classes are not included.`;
    $('snapshot-status').textContent = `Last read ${time} · no Etlab records changed`;
    if (!state.dataAvailable) notice('workspace-error', 'No per-subject attendance was returned. Planning is disabled for this snapshot.');
    announce(`Attendance refreshed. ${Object.keys(state.subjects).length} subjects loaded.`);
    if (Object.keys(state.subjects).some(code => !state.names[code])) {
      void enrichSubjectNames(generation, requestedSemester);
    }
  } catch (error) {
    if (generation !== state.generation || !state.token) return;
    state.dataAvailable = false;
    state.subjects = Object.create(null);
    notice('workspace-error', error.message);
    $('snapshot-line').textContent = 'Attendance is unavailable. Refresh to retry; the planner will not use stale hours.';
    renderAttendance();
    renderPlanner();
  } finally {
    if (generation === state.generation) { setLoading(false); renderAttendance(); }
  }
}
async function bootstrap() {
  const generation = state.generation;
  const [profileResult, semestersResult, timetableResult] = await Promise.allSettled([
    request('/api/profile'), request('/api/semesters'), request('/api/timetable'),
  ]);
  if (generation !== state.generation || !state.token) return;
  if (profileResult.status === 'rejected') throw profileResult.reason;
  if (!profileResult.value.profile_details?.name) throw new ApiError('Etlab returned an incomplete profile. Please try signing in again.');
  state.profile = profileResult.value.profile_details;
  state.imported = timetableResult.status === 'fulfilled' ? timetableResult.value : null;
  renderAccount();
  const select = $('semester');
  select.replaceChildren();
  const placeholder = node('option', '', 'Choose semester');
  placeholder.value = '';
  select.append(placeholder);
  const meta = semestersResult.status === 'fulfilled' ? semestersResult.value : null;
  const options = Array.isArray(meta?.semesters) && meta.semesters.length ? meta.semesters : Array.from({ length: 8 }, (_, index) => ({ value: index + 1, label: `Semester ${index + 1}` }));
  for (const option of options) {
    if (!Number.isInteger(option.value) || option.value < 1 || option.value > 8) continue;
    const element = node('option', '', option.label || `Semester ${option.value}`);
    element.value = option.value;
    select.append(element);
  }
  state.semester = Number.isInteger(meta?.current) && options.some(option => option.value === meta.current) ? meta.current : null;
  select.value = state.semester || '';
  $('login-screen').hidden = true;
  $('workspace').hidden = false;
  showView('attendance');
  const messages = [];
  if (!state.semester) messages.push('Your current semester could not be discovered. Choose it above to load attendance.');
  if (!state.imported) messages.push('The Etlab timetable could not be imported. You can still build your own week.');
  notice('workspace-note', messages.join(' '));
  if (state.semester) await loadSemester();
  else { setLoading(false); restoreTimetable(); renderAttendance(); renderPlanner(); }
}
function renderTimetable() {
  const lunchSelect = $('lunch-after');
  lunchSelect.replaceChildren(...Array.from({ length: state.periods - 1 }, (_, index) => {
    const option = node('option', '', `Period ${index + 1}`);
    option.value = index + 1;
    return option;
  }));
  lunchSelect.value = state.lunch;
  const header = node('tr');
  header.append(node('th', '', 'Weekday'));
  for (let period = 0; period < state.periods; period += 1) {
    const cell = node('th', period === state.lunch ? 'afternoon-start' : '', `P${period + 1}`);
    cell.scope = 'col';
    cell.append(node('small', '', period < state.lunch ? 'Before lunch' : 'After lunch'));
    header.append(cell);
  }
  $('timetable-head').replaceChildren(header);
  const fragment = document.createDocumentFragment();
  for (const day of DAYS) {
    const row = node('tr');
    const label = node('th', '', titleCase(day));
    label.scope = 'row';
    const clear = node('button', 'day-clear', 'No classes');
    clear.type = 'button';
    clear.dataset.clearDay = day;
    clear.setAttribute('aria-label', `Mark every ${titleCase(day)} period as free`);
    label.append(clear);
    row.append(label);
    for (let period = 0; period < state.periods; period += 1) {
      const cell = node('td', period === state.lunch ? 'afternoon-start' : '');
      const select = node('select');
      select.dataset.day = day;
      select.dataset.period = period;
      select.setAttribute('aria-label', `${titleCase(day)} period ${period + 1}`);
      for (const [value, text] of [['?', 'Unassigned'], ['', 'Free period']]) {
        const option = node('option', '', text);
        option.value = value;
        select.append(option);
      }
      for (const code of Object.keys(state.subjects)) {
        const option = node('option', '', state.names[code] ? `${code} · ${state.names[code]}` : code);
        option.value = code;
        select.append(option);
      }
      const value = state.draft[day]?.[period] ?? '?';
      if (value && value !== '?' && !Object.hasOwn(state.subjects, value)) {
        const stale = node('option', '', `${value} · no attendance data`);
        stale.value = value;
        select.append(stale);
      }
      select.value = value;
      select.className = value === '?' ? 'unassigned' : value === '' ? 'free' : 'assigned';
      select.title = value === '?' ? 'Unassigned — blocks leave calculations' : value === '' ? 'Explicitly free period' : `${value}${state.names[value] ? ` · ${state.names[value]}` : ''}`;
      cell.append(select);
      row.append(cell);
    }
    fragment.append(row);
  }
  $('timetable-body').replaceChildren(fragment);
}
function selectedSlots(excludeDate = null) {
  const slots = [];
  if (!state.saved) return slots;
  for (const [date, mode] of [...state.selections].sort(([a], [b]) => a.localeCompare(b))) {
    if (date === excludeDate) continue;
    const day = buildDates(date, 1)[0]?.day;
    const daySlots = state.saved.week[day] || [];
    slots.push(...(mode === 'afternoon' ? daySlots.slice(state.saved.lunch) : daySlots));
  }
  return slots;
}
function missedCounts(slots) {
  const missed = Object.create(null);
  for (const code of slots) if (code && code !== '?') missed[code] = (missed[code] || 0) + 1;
  return missed;
}
function blockerText(result) {
  if (!result.hasClasses) return 'No scheduled classes in these slots.';
  return result.blockers.slice(0, 2).map(blocker => {
    const code = blocker.code === '?' ? 'Unassigned slot' : blocker.code;
    return Number.isFinite(blocker.projectedPercentage) ? `${code}: ${percent(blocker.projectedPercentage)} after leave (target ${state.target}%)` : `${code}: ${blocker.reason || 'attendance unavailable'}`;
  }).join(' · ') || 'Outside the selected attendance target.';
}
function renderPlanSummary() {
  const slots = selectedSlots();
  const result = evaluateLeave(state.subjects, slots, state.target);
  const selectionCount = state.selections.size;
  $('plan-heading').textContent = !selectionCount ? 'No days selected.' : result.safe && state.dataAvailable ? `${selectionCount} ${selectionCount === 1 ? 'day' : 'days'}, within target.` : 'This plan exceeds your budget.';
  $('plan-description').textContent = !selectionCount ? 'Choose a full day or an afternoon. Every selection uses the same per-subject budget.' : result.safe && state.dataAvailable ? 'Every affected subject stays at or above your target in this conservative combined calculation.' : 'Remove a day or change your plan. Your selected target or latest attendance no longer supports this shortlist.';
  $('plan-heading').closest('.plan-summary').classList.toggle('invalid', selectionCount > 0 && (!result.safe || !state.dataAvailable));
  $('clear-plan').hidden = !selectionCount;
  const list = document.createDocumentFragment();
  for (const [date, mode] of [...state.selections].sort(([a], [b]) => a.localeCompare(b))) {
    const item = node('li');
    const label = node('span', '', new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
    label.append(node('small', '', mode === 'full' ? 'Full day' : `After period ${state.saved?.lunch || state.lunch}`));
    const remove = node('button', '', '×');
    remove.type = 'button';
    remove.dataset.removeDate = date;
    remove.setAttribute('aria-label', `Remove leave on ${date}`);
    item.append(label, remove);
    list.append(item);
  }
  $('selected-plan').replaceChildren(list);
  const impacts = document.createDocumentFragment();
  for (const [code, hours] of Object.entries(missedCounts(slots))) {
    const projection = result.projections[code] || calculateAttendance(NaN, NaN, state.target);
    const row = node('div', 'impact-row');
    const detail = node('span', '', code);
    detail.append(node('small', '', `${hours} ${hours === 1 ? 'period' : 'periods'} missed across your shortlist`));
    const value = node('strong', projection.status === 'below' || !projection.valid ? 'impact-below' : '', percent(projection.projectedPercentage));
    row.append(detail, value);
    impacts.append(row);
  }
  $('plan-impact').replaceChildren(impacts);
}
function renderPlanner() {
  $('planner-empty').hidden = !!state.saved && state.dataAvailable;
  $('planner-days').hidden = !state.saved || !state.dataAvailable;
  $('planner-empty').querySelector('h3').textContent = !state.saved ? 'Your week needs a timetable.' : 'Attendance needs a fresh snapshot.';
  $('planner-empty').querySelector('p').textContent = !state.saved ? 'Assign your subjects and save the timetable first. We won’t guess which classes you have.' : 'Load valid per-subject attendance before planning leave. Stale or missing data will not produce a recommendation.';
  renderPlanSummary();
  if (!state.saved || !state.dataAvailable) { $('planner-days').replaceChildren(); return; }
  let dates;
  try { dates = buildDates($('plan-start').value, 14); } catch { notice('workspace-error', 'Choose a valid planner start date.'); return; }
  const fragment = document.createDocumentFragment();
  for (const { date, day } of dates) {
    const row = node('div', `day-row${state.selections.has(date) ? ' selected' : ''}`);
    const time = new Date(`${date}T12:00:00`);
    const dateLabel = node('div', 'day-date');
    dateLabel.append(node('span', 'date-number', String(time.getDate()).padStart(2, '0')));
    const metadata = node('span', 'day-meta');
    metadata.append(node('strong', '', day.slice(0, 3)), document.createTextNode(time.toLocaleDateString([], { month: 'short' })));
    dateLabel.append(metadata);
    const classes = node('div');
    const chips = node('div', 'schedule-chips');
    const daySlots = state.saved.week[day];
    let hasAnyClass = false;
    daySlots.forEach((code, index) => {
      if (index === state.saved.lunch && daySlots.slice(index).some(value => value !== '')) chips.append(node('span', 'schedule-chip lunch-marker', 'LUNCH'));
      if (code === '') return;
      hasAnyClass = true;
      const chip = node('span', 'schedule-chip', code === '?' ? `P${index + 1} ?` : code);
      chip.title = `Period ${index + 1}${code !== '?' && state.names[code] ? ` · ${state.names[code]}` : ''}`;
      chips.append(chip);
    });
    if (!hasAnyClass) chips.append(node('span', 'muted', 'No scheduled classes'));
    classes.append(chips);
    const otherSlots = selectedSlots(date);
    const otherPlan = evaluateLeave(state.subjects, otherSlots, state.target);
    const cumulative = missedCounts(otherSlots);
    const full = evaluateLeave(state.subjects, daySlots, state.target, cumulative);
    const afternoon = evaluateLeave(state.subjects, daySlots.slice(state.saved.lunch), state.target, cumulative);
    const otherBlocked = otherSlots.length > 0 && !otherPlan.safe;
    const options = node('div', 'day-options');
    for (const [mode, text, result] of [['full', 'Full day', full], ['afternoon', 'Afternoon', afternoon]]) {
      const selected = state.selections.get(date) === mode;
      const button = node('button', 'leave-option', selected ? `✓ ${text}` : text);
      button.type = 'button';
      button.dataset.date = date;
      button.dataset.leave = mode;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${text} leave on ${date}`);
      button.disabled = !selected && (!result.safe || otherBlocked);
      button.title = selected ? 'Click to remove this selection' : otherBlocked ? 'Another selected day is outside your current budget. Remove it first.' : result.safe ? `${text} stays within your target${state.selections.size ? ' alongside the other selected days' : ''}.` : blockerText(result);
      options.append(button);
    }
    let message = !hasAnyClass ? 'No leave calculation needed for this day.' : full.safe && !otherBlocked ? 'Full day fits the current shared budget.' : afternoon.safe && !otherBlocked ? `Afternoon fits · full day blocked: ${blockerText(full)}` : blockerText(full);
    if (otherBlocked) message = 'A selected day is outside your target. Remove it before adding more.';
    classes.append(node('p', `day-note${!full.safe && !afternoon.safe && hasAnyClass ? ' blocked' : ''}`, message));
    row.append(dateLabel, classes, options);
    fragment.append(row);
  }
  $('planner-days').replaceChildren(fragment);
}
async function confirmAction(description) {
  const dialog = $('confirm-dialog');
  $('confirm-description').textContent = description;
  return new Promise(resolve => {
    const done = () => resolve(dialog.returnValue === 'confirm');
    dialog.addEventListener('close', done, { once: true });
    dialog.returnValue = 'cancel';
    dialog.showModal();
  });
}

$('portal-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('portal-submit').disabled) return;
  const supplied = $('portal-url').value.trim();
  if (!supplied) { notice('portal-error', 'Enter your college Etlab address.'); return; }
  notice('portal-error');
  $('portal-submit').disabled = true;
  $('portal-submit').firstElementChild.textContent = 'Checking portal…';
  try {
    const result = await apiFetch('/api/portal/check', { body: { portal_url: supplied }, signal: state.requests.signal, timeoutMs: 25000 });
    if (typeof result.portal_url !== 'string' || typeof result.hostname !== 'string') throw new ApiError('The server returned an invalid portal response.');
    state.portalUrl = result.portal_url;
    state.portalHost = result.hostname;
    $('portal-url').value = result.hostname;
    showCredentialsStep();
    $('username').focus();
    announce(`${result.hostname} selected. Enter your Etlab credentials.`);
  } catch (error) {
    notice('portal-error', error.message || 'Could not verify this Etlab portal.');
  } finally {
    $('portal-submit').disabled = false;
    $('portal-submit').firstElementChild.textContent = 'Continue securely';
  }
});
$('change-portal').addEventListener('click', () => {
  state.portalUrl = null;
  state.portalHost = null;
  $('username').value = '';
  $('password').value = '';
  showPortalStep();
  $('portal-url').focus();
  announce('Choose a different college Etlab portal.');
});
$('onboarding-skip').addEventListener('click', closeOnboarding);
$('onboarding-back').addEventListener('click', () => {
  onboardingStep = Math.max(0, onboardingStep - 1);
  renderOnboarding();
});
$('onboarding-next').addEventListener('click', () => {
  if (onboardingStep === ONBOARDING_STEPS.length - 1) { closeOnboarding(); $('portal-url').focus(); return; }
  onboardingStep += 1;
  renderOnboarding();
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('login-submit').disabled) return;
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!state.portalUrl) { showPortalStep(); notice('portal-error', 'Choose your college Etlab portal first.'); return; }
  if (!username || !password) { notice('login-error', 'Enter your Etlab username and password.'); return; }
  const generation = ++state.generation;
  const credentials = { portal_url: state.portalUrl, username, password };
  notice('login-error');
  $('login-submit').disabled = true;
  $('login-submit').firstElementChild.textContent = 'Connecting to Etlab…';
  try {
    const promise = apiFetch('/api/login', { body: credentials, signal: state.requests.signal });
    $('password').value = '';
    credentials.password = '';
    const result = await promise;
    if (generation !== state.generation) return;
    if (typeof result.token !== 'string' || !result.token.trim()) throw new ApiError('Etlab did not return a session. Please try again.');
    if (typeof result.portal_url === 'string') {
      state.portalUrl = result.portal_url;
      state.portalHost = new URL(result.portal_url).hostname;
    }
    state.token = result.token;
    await bootstrap();
  } catch (error) {
    if (generation === state.generation && $('workspace').hidden) {
      state.token = null;
      notice('login-error', error.message || 'Could not sign in. Please try again.');
    }
  } finally {
    $('password').value = '';
    credentials.password = '';
    $('login-submit').disabled = false;
    $('login-submit').firstElementChild.textContent = 'Open my dashboard';
  }
});
$('toggle-password').addEventListener('click', () => {
  const showing = $('password').type === 'password';
  $('password').type = showing ? 'text' : 'password';
  $('toggle-password').textContent = showing ? 'Hide' : 'Show';
  $('toggle-password').setAttribute('aria-pressed', String(showing));
  $('toggle-password').setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
});
$('logout-button').addEventListener('click', async () => {
  const token = state.token;
  resetSession();
  $('username').focus();
  try { await apiFetch('/api/logout', { token, timeoutMs: 25000 }); }
  catch { toast('Local session cleared. If Etlab is unavailable, also log out of the portal to invalidate its session.'); }
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('semester').addEventListener('change', async () => {
  const next = Number($('semester').value);
  if (!next || next === state.semester) return;
  if (state.dirty && !await confirmAction('Switching semesters discards unsaved timetable changes. Your previously saved week stays in this browser.')) { $('semester').value = state.semester || ''; return; }
  state.semester = next;
  state.selections.clear();
  state.saved = null;
  state.target = 75;
  await loadSemester();
});
$('refresh-button').addEventListener('click', () => loadSemester({ keepTimetable: true }));
$('subject-search').addEventListener('input', renderAttendance);
$('subject-filter').addEventListener('change', renderAttendance);
$('target').addEventListener('change', () => {
  const target = Number($('target').value);
  if (!validTarget(target)) { $('target').value = state.target; toast('Choose a target from 1 to 100%, with at most two decimal places.'); return; }
  state.target = target;
  try { if (state.profile && state.semester) localStorage.setItem(key('.preferences'), JSON.stringify({ target })); } catch { toast('Browser storage is unavailable. Your target still works in this session.'); }
  renderAttendance();
  renderPlanner();
  announce(`Attendance target changed to ${target} percent.`);
});

$('period-count').addEventListener('change', async () => {
  const periods = Number($('period-count').value);
  if (periods < state.periods && DAYS.some(day => state.draft[day].slice(periods).some(code => code !== '?')) && !await confirmAction('Reducing periods removes the slots at the end of each day. Save only when the shorter week is correct.')) { $('period-count').value = state.periods; return; }
  state.draft = Object.fromEntries(DAYS.map(day => [day, Array.from({ length: periods }, (_, index) => state.draft[day][index] ?? '?')]));
  state.periods = periods;
  state.lunch = Math.min(state.lunch, periods - 1);
  setDirty();
  renderTimetable();
});
$('lunch-after').addEventListener('change', () => { state.lunch = Number($('lunch-after').value); setDirty(); renderTimetable(); });
$('timetable-body').addEventListener('change', event => {
  const select = event.target.closest('select[data-day]');
  if (!select) return;
  state.draft[select.dataset.day][Number(select.dataset.period)] = select.value;
  select.className = select.value === '?' ? 'unassigned' : select.value === '' ? 'free' : 'assigned';
  setDirty();
});
$('timetable-body').addEventListener('click', event => {
  const button = event.target.closest('[data-clear-day]');
  if (!button) return;
  state.draft[button.dataset.clearDay] = Array(state.periods).fill('');
  setDirty();
  renderTimetable();
});
$('save-timetable').addEventListener('click', () => {
  if (!state.profile || !state.semester) { toast('Choose a semester before saving your timetable.'); return; }
  state.saved = { periods: state.periods, lunch: state.lunch, week: cloneWeek(state.draft) };
  try {
    localStorage.setItem(key('.timetable'), JSON.stringify(state.saved));
    setDirty(false);
    toast('Timetable saved. Your leave options are ready to check.');
  } catch {
    setDirty(false);
    $('timetable-save-status').textContent = 'Saved for this session only — browser storage is unavailable.';
    toast('Timetable works now, but could not be saved across visits.');
  }
  renderPlanner();
});
$('import-timetable').addEventListener('click', async () => {
  if (!state.token || !state.semester) { toast('Load your semester attendance first.'); return; }
  if ((state.dirty || state.saved) && !await confirmAction('Importing Etlab replaces the draft week, not your saved week. Unrecognised subjects remain unassigned. Review it before saving.')) return;
  $('import-timetable').disabled = true;
  try {
    state.imported = await request('/api/timetable');
    state.draft = importTimetable(state.imported, Object.keys(state.subjects), state.periods);
    updateSubjectNames();
    setDirty();
    renderTimetable();
    renderAttendance();
    toast('Imported into the draft. Review all days, including weekends, then save.');
  } catch (error) { if (state.token) toast(error.message); }
  finally { $('import-timetable').disabled = false; }
});
$('planner-days').addEventListener('click', event => {
  const button = event.target.closest('[data-date][data-leave]');
  if (!button || button.disabled) return;
  const { date, leave } = button.dataset;
  if (state.selections.get(date) === leave) state.selections.delete(date);
  else state.selections.set(date, leave);
  renderPlanner();
  announce(`${state.selections.size} leave dates selected. Combined impact recalculated.`);
});
$('selected-plan').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-date]');
  if (!button) return;
  state.selections.delete(button.dataset.removeDate);
  renderPlanner();
});
$('clear-plan').addEventListener('click', () => { state.selections.clear(); renderPlanner(); });
$('plan-start').min = localDate();
$('plan-start').value = buildDates(localDate(), 2)[1].date;
$('plan-start').addEventListener('change', () => {
  if (!$('plan-start').value || $('plan-start').value < localDate()) { toast('Choose today or a future start date.'); $('plan-start').value = buildDates(localDate(), 2)[1].date; }
  state.selections.clear();
  renderPlanner();
});
window.addEventListener('beforeunload', event => {
  if (state.dirty && state.token) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => { state.token = null; $('password').value = ''; });
window.addEventListener('pageshow', event => { if (event.persisted) resetSession('Please sign in again after returning to this page.'); });
renderOnboarding();
if (typeof $('onboarding-dialog').showModal === 'function') $('onboarding-dialog').showModal();
else $('onboarding-dialog').setAttribute('open', '');
