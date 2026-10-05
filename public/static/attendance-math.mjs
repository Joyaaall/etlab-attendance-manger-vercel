const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function importTimetable(apiTimetable, subjectCodes, periods = 8) {
  if (!Number.isSafeInteger(periods) || periods < 0) {
    throw new RangeError('Periods must be a nonnegative integer.');
  }
  const codes = new Set(subjectCodes);
  return Object.fromEntries(WEEKDAYS.map(day => [day,
    Array.from({length:periods}, (_, index) => {
      const row = apiTimetable && Object.hasOwn(apiTimetable, day) ? apiTimetable[day] : undefined;
      const key = `period-${index + 1}`;
      const cell = row && Object.hasOwn(row, key) ? row[key] : undefined;
      const name = cell && Object.hasOwn(cell, 'name') ? cell.name : undefined;
      if (typeof name !== 'string') return '?';
      if (name === '' || name === 'Free Period') return '';
      const code = name.split(' - ')[0];
      return codes.has(code) ? code : '?';
    }),
  ]));
}

export function buildDates(startDateString, days = 14) {
  if (typeof startDateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDateString)
    || !Number.isSafeInteger(days) || days < 0) {
    throw new RangeError('Expected a YYYY-MM-DD calendar date and nonnegative integer days.');
  }
  const date = new Date(`${startDateString}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== startDateString) {
    throw new RangeError('Invalid calendar date.');
  }
  const last = new Date(date);
  last.setUTCDate(last.getUTCDate() + Math.max(0, days - 1));
  if (!Number.isFinite(last.getTime()) || last.getUTCFullYear() > 9999) {
    throw new RangeError('Date range exceeds YYYY-MM-DD.');
  }
  return Array.from({length:days}, () => {
    const result = {date:date.toISOString().slice(0,10), day:WEEKDAYS[date.getUTCDay()]};
    date.setUTCDate(date.getUTCDate() + 1);
    return result;
  });
}

export function evaluateLeave(subjects, slots, target = 75, alreadyMissed = {}) {
  const missed = {};
  const projections = {};
  const blockers = [];
  for (const slot of slots) {
    const code = typeof slot === 'string' ? slot : '?';
    if (code === '') continue;
    Object.defineProperty(missed, code, {value: (Object.hasOwn(missed, code) ? missed[code] : 0) + 1,
      enumerable: true, writable: true, configurable: true});
  }
  for (const [code, hours] of Object.entries(missed)) {
    const subject = code !== '?' && Object.hasOwn(subjects, code) ? subjects[code] : undefined;
    const prior = Object.hasOwn(alreadyMissed, code) ? alreadyMissed[code] : 0;
    const cumulative = Number.isSafeInteger(prior) && prior >= 0 ? prior + hours : NaN;
    const projection = calculateAttendance(subject?.present, subject?.total, target, cumulative);
    Object.defineProperty(projections, code, {value:projection, enumerable:true});
    if (!projection.valid || projection.status === 'below') {
      blockers.push({code, reason: projection.reason, projectedPercentage: projection.projectedPercentage});
    }
  }
  const hasClasses = Object.keys(missed).length > 0;
  return {safe: hasClasses && blockers.length === 0, hasClasses, missed, blockers, projections};
}

export function calculateAttendance(present, total, target = 75, missed = 0) {
  const counts = [present, total, missed];
  const validCounts = counts.every(n => Number.isSafeInteger(n) && n >= 0);
  const validTarget = typeof target === 'number' && Number.isFinite(target)
    && target >= 1 && target <= 100 && /^\d+(?:\.\d{1,2})?$/.test(String(target));
  if (!validCounts || total === 0 || present > total || !validTarget) {
    return { valid: false, percentage: null, projectedPercentage: null,
      skipHours: null, attendHours: null, status: 'unknown',
      reason: 'Invalid attendance counts, target, or missed hours.' };
  }
  // Hundredths of a percentage point: all decisions use integer rationals.
  const [whole, fraction = ''] = String(target).split('.');
  const threshold = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const p = BigInt(present);
  const denominator = BigInt(total) + BigInt(missed);
  const deficit = threshold * denominator - 10000n * p;
  const budget = 10000n * p / threshold - denominator;
  const skipHours = Number(budget > 0n ? budget : 0n);
  const attendHours = deficit > 0n
    ? threshold === 10000n ? null
      : Number((deficit + (10000n - threshold) - 1n) / (10000n - threshold)) : 0;
  return { valid: true, percentage: 100 * present / total,
    projectedPercentage: 100 * present / (total + missed),
    skipHours, attendHours,
    status: deficit > 0n ? 'below' : skipHours === 0 ? 'at-risk' : 'comfortable',
    reason: deficit > 0n ? 'Projected attendance is below target.' : null };
}
