import { apiFetch, ApiError } from './api-client.mjs';
import { calculateAttendance, evaluateLeave, buildDates, importTimetable, plannerStartDate } from './attendance-math.mjs';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const $ = id => document.getElementById(id);
const titleCase = value => value.charAt(0).toUpperCase() + value.slice(1);
const percent = value => Number.isFinite(value) ? `${value.toFixed(1).replace(/\.0$/, '')}%` : '—';
const count = value => typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
const emptyWeek = periods => Object.fromEntries(DAYS.map(day => [day, Array(periods).fill('?')]));
const cloneWeek = week => Object.fromEntries(DAYS.map(day => [day, [...week[day]]]));
const localDate = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ONBOARDING_STEPS = [
  { label: 'COLLEGE', title: 'Choose your college portal.', description: "Paste your college's Etlab address. It works with or without https://." },
  { label: 'PRIVATE', title: 'Sign in like you normally do.', description: 'We use your password to log in, then clear it. Refreshing or signing out clears the session too.' },
  { label: 'SUBJECTS', title: 'Check every subject.', description: 'See how many classes you can miss, or how many you need to attend to get back above your target.' },
  { label: 'PLANNER', title: 'Try a day off before you take it.', description: 'Add your timetable, pick a date, and see how the missed classes would change each subject.' },
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
  $('onboarding-next').firstChild.textContent = onboardingStep === ONBOARDING_STEPS.length - 1 ? 'Got it ' : 'Next ';
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
  $('timetable-save-status').textContent = value ? 'You have unsaved changes. The planner is still using your last saved timetable.' : state.saved ? 'Saved in this browser for this account and semester.' : 'Not saved yet. Unassigned slots are not treated as free periods.';
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
  $('refresh-button').textContent = value ? 'Getting attendance...' : 'Refresh data';
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
  $('login-submit').firstElementChild.textContent = 'Show my attendance';
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
  $('greeting').textContent = 'Here is where you stand.';
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
  } catch { toast('We could not read your saved settings, so the timetable starts blank.'); }
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
    subjectCell.append(node('span', 'subject-code', code), node('span', 'subject-name', state.names[code] || 'Etlab did not include a subject name'));
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
    hours.append(node('small', '', 'attended / held'));
    hoursCell.append(hours);
    const budgetCell = node('td');
    let budget;
    let description;
    if (!result.valid) { budget = 'Unknown'; description = 'No attendance has been recorded yet'; }
    else if (result.status === 'below') {
      budget = result.attendHours === null ? 'Cannot reach 100%' : `Attend ${result.attendHours} ${result.attendHours === 1 ? 'hour' : 'hours'}`;
      description = result.attendHours === null ? 'Past absences will always count in the total' : `Attend the next ${result.attendHours} ${result.attendHours === 1 ? 'class' : 'classes'} to reach ${state.target}%`;
    } else {
      budget = `${result.skipHours} ${result.skipHours === 1 ? 'hour' : 'hours'} to spare`;
      description = result.skipHours ? 'Maximum classes you can miss right now' : 'Missing another class would put you below target';
    }
    budgetCell.append(node('span', `budget-badge ${result.status}`, budget), node('span', 'budget-description', description));
    row.append(subjectCell, attendanceCell, hoursCell, budgetCell);
    fragment.append(row);
  }
  $('subject-rows').replaceChildren(fragment);
  $('subjects-empty').hidden = state.loading || displayed !== 0;
  $('subjects-empty-message').textContent = entries.length ? 'Nothing matches that search or filter.' : 'Choose a semester or refresh your attendance before using the planner.';
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
  $('snapshot-line').textContent = 'Getting your latest attendance...';
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
    $('snapshot-line').textContent = `Semester ${state.semester}. Last checked at ${time}. Classes that have not happened yet are not included.`;
    $('snapshot-status').textContent = `Checked at ${time}. Your Etlab records were not changed.`;
    if (!state.dataAvailable) notice('workspace-error', 'Etlab did not return attendance for any subjects, so the planner is unavailable.');
    announce(`Attendance updated. ${Object.keys(state.subjects).length} subjects loaded.`);
    if (Object.keys(state.subjects).some(code => !state.names[code])) {
      void enrichSubjectNames(generation, requestedSemester);
    }
  } catch (error) {
    if (generation !== state.generation || !state.token) return;
    state.dataAvailable = false;
    state.subjects = Object.create(null);
    notice('workspace-error', error.message);
    $('snapshot-line').textContent = 'We could not load your attendance. Try refreshing. The planner will not use old data.';
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
  if (!state.semester) messages.push('We could not detect your current semester. Choose one above to load attendance.');
  if (!state.imported) messages.push('We could not import your Etlab timetable, but you can still build it here.');
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
        const stale = node('option', '', `${value} (no attendance data)`);
        stale.value = value;
        select.append(stale);
      }
      select.value = value;
      select.className = value === '?' ? 'unassigned' : value === '' ? 'free' : 'assigned';
      select.title = value === '?' ? 'Unassigned. The planner cannot calculate leave for this slot.' : value === '' ? 'Free period' : `${value}${state.names[value] ? `: ${state.names[value]}` : ''}`;
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
  if (!result.hasClasses) return 'You have no classes in these slots.';
  return result.blockers.slice(0, 2).map(blocker => {
    const code = blocker.code === '?' ? 'Unassigned slot' : blocker.code;
    return Number.isFinite(blocker.projectedPercentage) ? `${code}: ${percent(blocker.projectedPercentage)} after leave (target ${state.target}%)` : `${code}: ${blocker.reason || 'attendance unavailable'}`;
  }).join('. ') || 'This would put you below your attendance target.';
}
function renderPlanSummary() {
  const slots = selectedSlots();
  const result = evaluateLeave(state.subjects, slots, state.target);
  const selectionCount = state.selections.size;
  $('plan-heading').textContent = !selectionCount ? 'Nothing selected yet.' : result.safe && state.dataAvailable ? `${selectionCount} ${selectionCount === 1 ? 'day still keeps' : 'days still keep'} you at or above target.` : 'This would put you below target.';
  $('plan-description').textContent = !selectionCount ? 'Pick a full day or an afternoon. The planner checks all selected dates together.' : result.safe && state.dataAvailable ? 'Every affected subject stays at or above your chosen percentage.' : 'Remove a date or change your plan. One or more subjects no longer have enough margin.';
  $('plan-heading').closest('.plan-summary').classList.toggle('invalid', selectionCount > 0 && (!result.safe || !state.dataAvailable));
  $('clear-plan').hidden = !selectionCount;
  const list = document.createDocumentFragment();
  for (const [date, mode] of [...state.selections].sort(([a], [b]) => a.localeCompare(b))) {
    const item = node('li');
    const label = node('span', '', new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
    label.append(node('small', '', mode === 'full' ? 'Full day' : `After period ${state.saved?.lunch || state.lunch}`));
    const remove = node('button', '', 'Remove');
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
    detail.append(node('small', '', `${hours} ${hours === 1 ? 'class' : 'classes'} missed on the dates you picked`));
    const value = node('strong', projection.status === 'below' || !projection.valid ? 'impact-below' : '', percent(projection.projectedPercentage));
    row.append(detail, value);
    impacts.append(row);
  }
  $('plan-impact').replaceChildren(impacts);
}
function renderPlanner() {
  $('planner-empty').hidden = !!state.saved && state.dataAvailable;
  $('planner-days').hidden = !state.saved || !state.dataAvailable;
  $('planner-empty').querySelector('h3').textContent = !state.saved ? 'Add your timetable first.' : 'Refresh your attendance first.';
  $('planner-empty').querySelector('p').textContent = !state.saved ? 'The planner needs to know which classes fall on each day.' : 'We need current attendance for each subject before we can check a day off.';
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
    if (!hasAnyClass) chips.append(node('span', 'muted', 'No classes scheduled'));
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
      const button = node('button', 'leave-option', selected ? `${text} selected` : text);
      button.type = 'button';
      button.dataset.date = date;
      button.dataset.leave = mode;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${text} leave on ${date}`);
      button.disabled = !selected && (!result.safe || otherBlocked);
      button.title = selected ? 'Click again to remove this date' : otherBlocked ? 'Another selected date already puts you below target. Remove it first.' : result.safe ? `${text} keeps every subject at or above your target${state.selections.size ? ' when combined with the other dates' : ''}.` : blockerText(result);
      options.append(button);
    }
    let message = !hasAnyClass ? 'There are no classes to miss on this day.' : full.safe && !otherBlocked ? 'You can miss the full day and stay at or above target.' : afternoon.safe && !otherBlocked ? `The afternoon is okay. A full day is not: ${blockerText(full)}` : blockerText(full);
    if (otherBlocked) message = 'One selected date already puts you below target. Remove it before adding another.';
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
  if (!supplied) { notice('portal-error', 'Enter the Etlab address your college gave you.'); return; }
  notice('portal-error');
  $('portal-submit').disabled = true;
  $('portal-submit').firstElementChild.textContent = 'Checking this portal...';
  try {
    const result = await apiFetch('/api/portal/check', { body: { portal_url: supplied }, signal: state.requests.signal, timeoutMs: 25000 });
    if (typeof result.portal_url !== 'string' || typeof result.hostname !== 'string') throw new ApiError('The portal check returned something we could not read. Try again.');
    state.portalUrl = result.portal_url;
    state.portalHost = result.hostname;
    $('portal-url').value = result.hostname;
    showCredentialsStep();
    $('username').focus();
    announce(`${result.hostname} is ready. Enter your Etlab login.`);
  } catch (error) {
    notice('portal-error', error.message || 'We could not confirm that this is an Etlab student portal.');
  } finally {
    $('portal-submit').disabled = false;
    $('portal-submit').firstElementChild.textContent = 'Use this portal';
  }
});
$('change-portal').addEventListener('click', () => {
  state.portalUrl = null;
  state.portalHost = null;
  $('username').value = '';
  $('password').value = '';
  showPortalStep();
  $('portal-url').focus();
  announce('Choose a different college portal.');
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
  if (!state.portalUrl) { showPortalStep(); notice('portal-error', 'Choose your college portal first.'); return; }
  if (!username || !password) { notice('login-error', 'Enter the username and password you use on Etlab.'); return; }
  const generation = ++state.generation;
  const credentials = { portal_url: state.portalUrl, username, password };
  notice('login-error');
  $('login-submit').disabled = true;
  $('login-submit').firstElementChild.textContent = 'Signing in...';
  try {
    const promise = apiFetch('/api/login', { body: credentials, signal: state.requests.signal });
    $('password').value = '';
    credentials.password = '';
    const result = await promise;
    if (generation !== state.generation) return;
    if (typeof result.token !== 'string' || !result.token.trim()) throw new ApiError('Etlab did not finish signing you in. Try again.');
    if (typeof result.portal_url === 'string') {
      state.portalUrl = result.portal_url;
      state.portalHost = new URL(result.portal_url).hostname;
    }
    state.token = result.token;
    await bootstrap();
  } catch (error) {
    if (generation === state.generation && $('workspace').hidden) {
      state.token = null;
      notice('login-error', error.message || 'We could not sign you in. Check your details and try again.');
    }
  } finally {
    $('password').value = '';
    credentials.password = '';
    $('login-submit').disabled = false;
    $('login-submit').firstElementChild.textContent = 'Show my attendance';
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
  catch { toast('You are signed out here. If Etlab is down, sign out on the Etlab site later too.'); }
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('semester').addEventListener('change', async () => {
  const next = Number($('semester').value);
  if (!next || next === state.semester) return;
  if (state.dirty && !await confirmAction('Changing semesters will discard the timetable edits you have not saved. Your last saved timetable will stay in this browser.')) { $('semester').value = state.semester || ''; return; }
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
  if (!validTarget(target)) { $('target').value = state.target; toast('Enter a percentage from 1 to 100, with no more than two decimal places.'); return; }
  state.target = target;
  try { if (state.profile && state.semester) localStorage.setItem(key('.preferences'), JSON.stringify({ target })); } catch { toast('Your browser could not save this target, but it will still work until you leave the page.'); }
  renderAttendance();
  renderPlanner();
  announce(`Attendance target changed to ${target} percent.`);
});

$('period-count').addEventListener('change', async () => {
  const periods = Number($('period-count').value);
  if (periods < state.periods && DAYS.some(day => state.draft[day].slice(periods).some(code => code !== '?')) && !await confirmAction('Reducing the number of periods will remove the last slots from every day. Continue only if that matches your week.')) { $('period-count').value = state.periods; return; }
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
  if (!state.profile || !state.semester) { toast('Choose a semester before you save the timetable.'); return; }
  state.saved = { periods: state.periods, lunch: state.lunch, week: cloneWeek(state.draft) };
  try {
    localStorage.setItem(key('.timetable'), JSON.stringify(state.saved));
    setDirty(false);
    toast('Timetable saved. You can check days off now.');
  } catch {
    setDirty(false);
    $('timetable-save-status').textContent = 'Saved for this visit only. Your browser would not save it for next time.';
    toast('The timetable works for this visit, but it will be gone when you leave the page.');
  }
  renderPlanner();
});
$('import-timetable').addEventListener('click', async () => {
  if (!state.token || !state.semester) { toast('Load attendance for a semester first.'); return; }
  if ((state.dirty || state.saved) && !await confirmAction('Importing from Etlab will replace the timetable you are editing. Your last saved version stays untouched until you save again. Check any unassigned subjects before saving.')) return;
  $('import-timetable').disabled = true;
  try {
    state.imported = await request('/api/timetable');
    state.draft = importTimetable(state.imported, Object.keys(state.subjects), state.periods);
    updateSubjectNames();
    setDirty();
    renderTimetable();
    renderAttendance();
    toast('Timetable imported. Check every day, including weekends, before you save it.');
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
  announce(`${state.selections.size} ${state.selections.size === 1 ? 'date' : 'dates'} selected. Attendance updated.`);
});
$('selected-plan').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-date]');
  if (!button) return;
  state.selections.delete(button.dataset.removeDate);
  renderPlanner();
});
$('clear-plan').addEventListener('click', () => { state.selections.clear(); renderPlanner(); });
$('plan-start').min = localDate();
$('plan-start').value = plannerStartDate(localDate());
$('plan-start').addEventListener('change', () => {
  if (!$('plan-start').value || $('plan-start').value < localDate()) { toast('Pick today or a later date.'); $('plan-start').value = plannerStartDate(localDate()); }
  state.selections.clear();
  renderPlanner();
});
window.addEventListener('beforeunload', event => {
  if (state.dirty && state.token) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => { state.token = null; $('password').value = ''; });
window.addEventListener('pageshow', event => { if (event.persisted) resetSession('You came back to an old page, so please sign in again.'); });
renderOnboarding();
if (typeof $('onboarding-dialog').showModal === 'function') $('onboarding-dialog').showModal();
else $('onboarding-dialog').setAttribute('open', '');
