import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// All API data and credentials below are synthetic test fixtures, not live Etlab results.
const baseURL = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5001';
let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => { await browser?.close(); });

const register = {
  name: 'Fixture Student', roll_no: '1', university_reg_no: 'TEST-ONLY',
  CST501: { present_hours: '30', total_hours: '36', attendance_percentage: '83.33%' },
  CST502: { present_hours: '18', total_hours: '24', attendance_percentage: '75%' },
  LAB503: { present_hours: '12', total_hours: '14', attendance_percentage: '85.71%' },
  CST504: { present_hours: '7', total_hours: '10', attendance_percentage: '70%' },
  EMPTY: { present_hours: '0', total_hours: '0', attendance_percentage: 'N/A' },
  total_present_hours: '67', total_hours: '84', total_percentage: '79.76%',
};
const importedWeek = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`period-${index + 1}`, { name: 'Free Period' }]))]));
importedWeek.monday['period-1'] = { name: 'CST501 - COMPUTER NETWORKS', teacher: 'Fixture Teacher' };

async function openFixture({ viewport = { width: 1440, height: 950 }, failLogin = false, failPortal = false, keepOnboarding = false } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-04T06:00:00Z'));
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ path, headers: request.headers(), body: request.postDataJSON() });
    let status = 200;
    let body;
    if (path === '/api/portal/check') {
      body = failPortal ? { message: 'This address does not appear to be a supported Etlab student portal.' } : { portal_url: 'https://fixture.etlab.app', hostname: 'fixture.etlab.app' };
      if (failPortal) status = 422;
    } else if (path === '/api/login') {
      body = failLogin ? { message: 'Invalid username or password' } : { token: 'fixture-session-not-a-real-credential', portal_url: 'https://fixture.etlab.app' };
      if (failLogin) status = 401;
    } else if (path === '/api/profile') {
      body = { profile_details: { name: 'Fixture Student', admission_no: 'FIXTURE-ONLY', dob: '', university_roll_no: 'TEST-ONLY' } };
    } else if (path === '/api/semesters') {
      body = { current: 5, semesters: [{ value: 4, label: 'IVth Semester' }, { value: 5, label: 'Vth Semester' }] };
    } else if (path === '/api/attendance') body = register;
    else if (path === '/api/subject-names') body = { subject_names: {} };
    else if (path === '/api/timetable') body = importedWeek;
    else if (path === '/api/logout') body = { message: 'Logged out successfully' };
    else { status = 404; body = { message: 'Unexpected test request' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(baseURL);
  if (!keepOnboarding && await page.locator('#onboarding-dialog').isVisible()) {
    await page.locator('#onboarding-skip').click();
  }
  return { context, page, errors, requests };
}

async function signIn(page) {
  // Fixture-only credentials, unrelated to any real account.
  await page.locator('#portal-url').fill('fixture.etlab.app');
  await page.locator('#portal-submit').click();
  await page.locator('#credentials-step').waitFor({ state: 'visible' });
  await page.locator('#username').fill('fixture-student');
  await page.locator('#password').fill('fixture-password-only');
  await page.locator('#login-submit').click();
  await page.locator('#workspace').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#subject-rows tr').first().waitFor({ timeout: 5000 });
}

async function capture(page, name) {
  if (!process.env.CAPTURE_SCREENSHOTS) return;
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true, animations: 'disabled' });
}

test('onboarding can be skipped and returns on every fresh visit without tracking', async () => {
  const { context, page, errors } = await openFixture({ viewport: { width: 390, height: 844 }, keepOnboarding: true });
  try {
    const dialog = page.locator('#onboarding-dialog');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    assert.match(await page.locator('#onboarding-progress').innerText(), /1 \/ 4/);
    assert.match(await page.locator('#onboarding-title').innerText(), /college portal/i);
    await page.locator('#onboarding-next').click();
    assert.match(await page.locator('#onboarding-progress').innerText(), /2 \/ 4/);
    await page.locator('#onboarding-skip').click();
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.locator('a[href="https://buymeacoffee.com/joyalaliyas"]').count(), 2);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.doesNotMatch(storage, /onboarding/i);
    await page.reload();
    await dialog.waitFor({ state: 'visible' });
    assert.match(await page.locator('#onboarding-progress').innerText(), /1 \/ 4/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('onboarding is styled and contained on a short tablet viewport', async () => {
  const { context, page, errors } = await openFixture({ viewport: { width: 796, height: 422 }, keepOnboarding: true });
  try {
    const dialog = page.locator('#onboarding-dialog');
    await dialog.waitFor({ state: 'visible' });
    const layout = await dialog.evaluate(element => {
      const visual = element.querySelector('.onboarding-visual');
      const dialogStyle = getComputedStyle(element);
      const visualStyle = getComputedStyle(visual);
      const rect = element.getBoundingClientRect();
      return {
        display: dialogStyle.display,
        columns: dialogStyle.gridTemplateColumns,
        radius: dialogStyle.borderRadius,
        visualBackground: visualStyle.backgroundColor,
        insideViewport: rect.top >= 0 && rect.bottom <= innerHeight,
      };
    });
    assert.equal(layout.display, 'grid');
    assert.match(layout.columns, /^270px /);
    assert.equal(layout.radius, '14px');
    assert.equal(layout.visualBackground, 'rgb(23, 63, 53)');
    assert.equal(layout.insideViewport, true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('username login reaches per-subject attendance, and no credentials are persisted', async () => {
  const { context, page, requests, errors } = await openFixture();
  try {
    assert.equal(await page.title(), 'Attendance Manager — Etlab');
    assert.equal(await page.locator('a[href*="apidocs"], #formula-button, #formula-note, .connection-note').count(), 0);
    assert.match(await page.locator('#login-screen .wordmark').innerText(), /Attendance Manager/);
    await signIn(page);
    assert.match(await page.locator('.app-header .wordmark').innerText(), /Attendance Manager/);
    assert.equal(await page.locator('#semester').inputValue(), '5');
    assert.equal(await page.locator('#subject-rows tr').count(), 5);
    assert.match(await page.locator('[data-subject="CST501"]').innerText(), /4 hours/);
    assert.match(await page.locator('[data-subject="CST502"]').innerText(), /0 hours/);
    assert.match(await page.locator('[data-subject="CST504"]').innerText(), /2 hours/);
    assert.match(await page.locator('[data-subject="EMPTY"]').innerText(), /Unknown/);
    assert.equal(await page.locator('#password').inputValue(), '');
    const login = requests.find(request => request.path === '/api/login');
    assert.deepEqual(login.body, { portal_url: 'https://fixture.etlab.app', username: 'fixture-student', password: 'fixture-password-only' });
    assert.match(requests.find(request => request.path === '/api/attendance').headers.authorization, /^Bearer fixture-session/);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.doesNotMatch(storage, /fixture-password|fixture-session/);
    await capture(page, 'desktop-attendance-synthetic');
    await page.reload();
    await page.locator('#login-screen').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('subject labels use register and monthly names when the timetable omits them', async () => {
  const { context, page, errors } = await openFixture();
  try {
    await page.route('**/api/attendance?semester=5', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ...register,
        EMPTY: { ...register.EMPTY, subject_name: 'SYNTHETIC PRACTICAL' },
        CST501: { ...register.CST501, subject_name: 'CURRENT REGISTER NAME' },
      }),
    }));
    await page.route('**/api/subject-names?semester=5', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ subject_names: {
        LAB503: 'SYNTHETIC LAB NAME', CST504: 'SYNTHETIC ELECTIVE NAME',
        CST501: 'MONTHLY ALTERNATIVE', GHOST: 'NOT A REGISTER SUBJECT',
      } }),
    }));
    await signIn(page);
    await page.locator('[data-subject="LAB503"] .subject-name').filter({ hasText: 'SYNTHETIC LAB NAME' }).waitFor();
    assert.match(await page.locator('[data-subject="EMPTY"]').innerText(), /SYNTHETIC PRACTICAL/);
    assert.match(await page.locator('[data-subject="EMPTY"]').innerText(), /Unknown/);
    assert.equal(await page.locator('[data-subject="CST501"] .subject-name').innerText(), 'CURRENT REGISTER NAME');
    assert.equal(await page.locator('#subject-rows tr').count(), 5);
    await page.locator('#subject-search').fill('synthetic elective');
    assert.equal(await page.locator('#subject-rows tr').count(), 1);
    await page.locator('.app-nav [data-view="timetable"]').click();
    assert.match(await page.locator('select[data-day="monday"][data-period="0"]').innerText(), /LAB503 · SYNTHETIC LAB NAME/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('saving a custom timetable computes cumulative full-day and afternoon leave options', async () => {
  const { context, page, errors } = await openFixture();
  try {
    await signIn(page);
    await page.locator('.app-nav [data-view="timetable"]').click();
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      await page.locator(`[data-clear-day="${day}"]`).click();
    }
    for (const [day, period, subject] of [
      ['monday', 0, 'CST501'], ['monday', 4, 'CST501'], ['monday', 5, 'CST501'],
      ['tuesday', 4, 'CST502'], ['wednesday', 4, 'LAB503'], ['wednesday', 5, 'LAB503'],
    ]) {
      await page.locator(`select[data-day="${day}"][data-period="${period}"]`).selectOption(subject);
    }
    await page.locator('#save-timetable').click();
    assert.match(await page.locator('#timetable-save-status').innerText(), /Saved/);
    await page.locator('.app-nav [data-view="planner"]').click();
    await page.locator('#plan-start').fill('2026-11-02');
    await page.locator('#plan-start').dispatchEvent('change');
    const mondayFull = page.locator('[data-date="2026-11-02"][data-leave="full"]');
    assert.equal(await mondayFull.isEnabled(), true);
    assert.equal(await page.locator('[data-date="2026-11-03"][data-leave="afternoon"]').isEnabled(), false);
    await mondayFull.click();
    assert.equal(await page.locator('[data-date="2026-11-09"][data-leave="full"]').isEnabled(), false);
    assert.equal(await page.locator('[data-date="2026-11-09"][data-leave="afternoon"]').isEnabled(), false);
    assert.match(await page.locator('#plan-impact').innerText(), /76\.9/);
    await page.locator('#clear-plan').click();
    await page.locator('[data-date="2026-11-02"][data-leave="afternoon"]').click();
    assert.equal(await page.locator('[data-date="2026-11-09"][data-leave="afternoon"]').isEnabled(), true);
    await page.locator('[data-date="2026-11-09"][data-leave="afternoon"]').click();
    assert.match(await page.locator('#plan-impact').innerText(), /75/);
    assert.equal(await page.locator('#selected-plan li').count(), 2);
    await capture(page, 'desktop-planner-synthetic');
    await page.locator('#target').fill('90');
    await page.locator('#target').dispatchEvent('change');
    assert.match(await page.locator('#plan-heading').innerText(), /exceeds|outside|over/i);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('wrong credentials show a recoverable login error', async () => {
  const { context, page, errors } = await openFixture({ failLogin: true });
  try {
    await page.locator('#portal-url').fill('fixture.etlab.app');
    await page.locator('#portal-submit').click();
    await page.locator('#username').fill('fixture-student');
    await page.locator('#password').fill('fixture-password-only');
    await page.locator('#login-submit').click();
    await page.locator('#login-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#login-error').innerText(), /Invalid username or password/);
    assert.equal(await page.locator('#login-submit').isEnabled(), true);
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('unsupported college portal stays on the portal step', async () => {
  const { context, page, errors } = await openFixture({ failPortal: true });
  try {
    await page.locator('#portal-url').fill('not-etlab.example');
    await page.locator('#portal-submit').click();
    await page.locator('#portal-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#portal-error').innerText(), /supported Etlab student portal/i);
    assert.equal(await page.locator('#credentials-step').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('mobile layout fits the viewport and keyboard navigation remains available', async () => {
  const { context, page, errors } = await openFixture({ viewport: { width: 390, height: 844 } });
  try {
    await capture(page, 'mobile-login');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content');
    await signIn(page);
    await capture(page, 'mobile-attendance-synthetic');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('.app-nav [data-view="timetable"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a failed semester switch never inherits the previous semester timetable', async () => {
  const { context, page, errors } = await openFixture();
  try {
    await signIn(page);
    await page.locator('.app-nav [data-view="timetable"]').click();
    await page.locator('[data-clear-day="monday"]').click();
    await page.locator('select[data-day="monday"][data-period="0"]').selectOption('CST501');
    await page.locator('#save-timetable').click();
    await page.route('**/api/attendance?semester=4', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'Fixture semester unavailable' }) }));
    await page.locator('#semester').selectOption('4');
    await page.locator('#workspace-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('select[data-day="monday"][data-period="0"]').inputValue(), '?');
    await page.locator('.app-nav [data-view="planner"]').click();
    assert.equal(await page.locator('#planner-days').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
