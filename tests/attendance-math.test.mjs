import test from 'node:test';
import assert from 'node:assert/strict';
const domain = await import('../public/static/attendance-math.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('importTimetable treats missing and malformed cells as unknown and validates periods', () => {
  const monday = Object.create({'period-1':{name:'Free Period'}});
  Object.assign(monday, {'period-2':{}, 'period-3':null, 'period-4':{name:42}});
  const result = domain.importTimetable({monday}, ['A'], 4);
  for (const row of Object.values(result)) assert.deepEqual(row, ['?','?','?','?']);
  for (const periods of [-1, 1.5, '8', NaN, Infinity]) {
    assert.throws(() => domain.importTimetable({},[],periods), RangeError);
  }
  assert.deepEqual(domain.importTimetable({},[],0).monday, []);
});

test('importTimetable maps exact subject prefixes and explicit free cells', () => {
  assert.equal(typeof domain.importTimetable, 'function');
  const api = Object.freeze({monday:Object.freeze({
    'period-1':{name:'CS101 - Computing'}, 'period-2':{name:'Free Period'},
    'period-3':{name:''}, 'period-4':{name:'CS101 - Lab'},
    'period-5':{name:'CS101'}, 'period-6':{name:'CS10 - Not an exact match'},
    'period-7':{name:'Mystery'}, 'period-8':{name:'CS101X - Wrong prefix'},
  })});
  const result = domain.importTimetable(api,['CS101']);
  assert.deepEqual(result.monday,['CS101','','','CS101','CS101','?','?','?']);
  assert.deepEqual(Object.keys(result).sort(),
    ['friday','monday','saturday','sunday','thursday','tuesday','wednesday']);
  assert.deepEqual(result.sunday, Array(8).fill('?'));
});

test('buildDates rejects malformed or impossible calendar dates and invalid day counts', () => {
  for (const date of ['2025-02-29','2026-04-31','2026-13-01','2026-00-01',
    '2026-01-00','2026-1-01','2026-01-01T00:00:00Z',' 2026-01-01', '', null, 20260101]) {
    assert.throws(() => domain.buildDates(date), RangeError, String(date));
  }
  for (const count of [-1,1.5,'2',NaN,Infinity]) {
    assert.throws(() => domain.buildDates('2026-01-01',count), RangeError);
  }
  assert.throws(() => domain.buildDates('9999-12-31',2), RangeError);
});

test('buildDates crosses month, leap day, year and DST as calendar days', () => {
  assert.equal(typeof domain.buildDates, 'function');
  assert.deepEqual(domain.buildDates('2024-02-28',3), [
    {date:'2024-02-28',day:'wednesday'}, {date:'2024-02-29',day:'thursday'},
    {date:'2024-03-01',day:'friday'},
  ]);
  assert.deepEqual(domain.buildDates('2026-12-31',2), [
    {date:'2026-12-31',day:'thursday'}, {date:'2027-01-01',day:'friday'},
  ]);
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC','America/New_York','Europe/Berlin','Pacific/Auckland']) {
      process.env.TZ = tz;
      assert.deepEqual(domain.buildDates('2026-03-07',3).map(x=>x.date),
        ['2026-03-07','2026-03-08','2026-03-09']);
      assert.deepEqual(domain.buildDates('2026-10-31',3).map(x=>x.date),
        ['2026-10-31','2026-11-01','2026-11-02']);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  assert.equal(domain.buildDates('2026-01-01').length,14);
  assert.deepEqual(domain.buildDates('2026-01-01',0),[]);
});

test('planner starts on the current local calendar day', () => {
  assert.equal(typeof domain.plannerStartDate, 'function');
  assert.equal(domain.plannerStartDate('2026-10-05'), '2026-10-05');
});

test('malformed slot values cannot be coerced into mapped subject codes', () => {
  const subjects = {'1':{present:8,total:8}, 'null':{present:8,total:8},
    'undefined':{present:8,total:8}, '[object Object]':{present:8,total:8}};
  for (const slot of [1,null,undefined,{}]) {
    const result = domain.evaluateLeave(subjects,[slot]);
    assert.equal(result.safe, false);
    assert.deepEqual(result.missed, {'?':1});
    assert.equal(result.blockers[0].code, '?');
  }
});

test('unknown assignments block leave even when question mark is a subject key', () => {
  assert.equal(domain.evaluateLeave({'?':{present:8,total:8}}, ['?']).safe, false);
  for (const slots of [['MISSING'], ['toString'], [null], [undefined]]) {
    const result = domain.evaluateLeave({}, slots);
    assert.equal(result.safe, false);
    assert.equal(result.blockers[0].projectedPercentage, null);
  }
  for (const subject of [{present:0,total:0},{present:'8',total:8},{present:9,total:8}]) {
    assert.equal(domain.evaluateLeave({A:subject}, ['A']).safe, false);
  }
  for (const slots of [[], ['', '', '']]) {
    assert.deepEqual(domain.evaluateLeave({},slots), {
      safe:false, hasClasses:false, missed:{}, blockers:[], projections:{},
    });
  }
});

test('cumulative two-day leave conflicts are blocked without mutating inputs', () => {
  const subjects = Object.freeze({A:Object.freeze({present:8,total:8})});
  const previous = Object.freeze({A:2});
  const result = domain.evaluateLeave(subjects, Object.freeze(['A']), 75, previous);
  assert.equal(result.safe, false);
  assert.deepEqual(result.missed, {A:1});
  assert.equal(result.projections.A.projectedPercentage, 800/11);
  for (const invalid of ['1', -1, 0.5, NaN, Infinity, null]) {
    assert.equal(domain.evaluateLeave(subjects,['A'],75,{A:invalid}).safe, false);
  }
});

test('leave counts repeated lab periods and blocks projected deficits', () => {
  assert.equal(typeof domain.evaluateLeave, 'function');
  const subjects = { LAB: {present:8,total:8}, LOW: {present:1,total:4} };
  const safe = domain.evaluateLeave(subjects, ['LAB','','LAB']);
  assert.equal(safe.safe, true);
  assert.equal(safe.hasClasses, true);
  assert.deepEqual(safe.missed, {LAB:2});
  assert.deepEqual(safe.blockers, []);
  assert.deepEqual(safe.projections, {LAB:domain.calculateAttendance(8,8,75,2)});
  const blocked = domain.evaluateLeave(subjects, ['LAB','LAB','LAB']);
  assert.equal(blocked.safe, false);
  assert.equal(blocked.blockers[0].code, 'LAB');
  assert.equal(blocked.blockers[0].projectedPercentage, 800/11);
  assert.equal(typeof blocked.blockers[0].reason, 'string');
});

test('exact 75 percent has no leave budget and is at risk', () => {
  assert.equal(typeof domain.calculateAttendance, 'function');
  assert.deepEqual(domain.calculateAttendance(3, 4), {
    valid: true, percentage: 75, projectedPercentage: 75,
    skipHours: 0, attendHours: 0, status: 'at-risk', reason: null,
  });
});

test('invalid counts, thresholds and missed hours never provide a budget', () => {
  const cases = [[0,0], [4,3], [-1,4], [1.5,4], ['3',4], [3,'4'],
    [NaN,4], [3,Infinity], [null,4], [undefined,4],
    [3,4,0], [3,4,101], [3,4,75.001], [3,4,'75'], [3,4,NaN],
    [3,4,75,-1], [3,4,75,0.5], [3,4,75,'1'], [3,4,75,Infinity],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]];
  for (const args of cases) {
    const result = domain.calculateAttendance(...args);
    assert.equal(result.valid, false, JSON.stringify(args));
    for (const key of ['percentage','projectedPercentage','skipHours','attendHours']) {
      assert.equal(result[key], null);
    }
    assert.equal(result.status, 'unknown');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length);
  }
});

test('100 percent target deficits are irrecoverable, not a division error', () => {
  for (const args of [[3,4,100], [4,4,100,1]]) {
    const result = domain.calculateAttendance(...args);
    assert.equal(result.valid, true);
    assert.equal(result.attendHours, null);
    assert.equal(result.skipHours, 0);
    assert.equal(result.status, 'below');
  }
  assert.equal(domain.calculateAttendance(4,4,100).attendHours, 0);
});

test('budgets and recovery use exact rational decimal boundaries', () => {
  const cases = [
    [8,8,75,0,2,0,'comfortable'], [8,8,75,2,0,0,'at-risk'],
    [8,8,75,3,0,1,'below'], [0,4,75,0,0,12,'below'],
    [7499,10000,75,0,0,4,'below'], [29,50,58,0,0,0,'at-risk'],
    [6667,10000,66.67,0,0,0,'at-risk'], [6666,10000,66.67,0,0,4,'below'],
    [2,3,66.66,0,0,0,'at-risk'], [2,3,66.67,0,0,1,'below'],
  ];
  for (const [p,t,target,m,skip,attend,status] of cases) {
    const result = domain.calculateAttendance(p,t,target,m);
    assert.equal(result.skipHours, skip, JSON.stringify([p,t,target,m]));
    assert.equal(result.attendHours, attend);
    assert.equal(result.status, status);
    assert.equal(result.projectedPercentage, 100*p/(t+m));
  }
});
