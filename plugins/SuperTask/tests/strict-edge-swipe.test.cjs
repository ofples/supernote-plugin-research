const {test} = require('node:test');
const assert = require('node:assert/strict');
const {StrictEdgeSwipe} = require('../src/launcher/strictEdgeSwipe.cjs');

function trace({
  ids = [17, 3, 42],
  fourth = false,
  lateral = 0,
  lag = 0,
  jump = false,
  cancel = false,
  start = 5000,
  bottom = 1830,
  pen = false,
} = {}) {
  const p = (i, y = bottom, xShift = 0) => ({
    pointerId: ids[i],
    toolType: 1,
    x: 500 + i * 65 + xShift,
    y,
  });
  const e = (action, offset, pointers, actionIndex = 0) => ({
    action,
    eventTime: start + offset,
    pointers,
    pointerCount: pointers.length,
    toolType: 1,
    actionIndex,
  });
  const events = [
    e(0, 0, [p(0)]),
    e(5, 70, [p(0), p(1)], 1),
    e(5, 120, [p(0), p(1), p(2)], 2),
  ];
  if (fourth)
    events.push(
      e(
        5,
        150,
        [p(0), p(1), p(2), {pointerId: 99, toolType: 1, x: 700, y: bottom}],
        3,
      ),
    );
  for (const [offset, travel] of [
    [250, 55],
    [400, 110],
    [550, 170],
  ])
    events.push(
      e(2, offset, [
        p(2, bottom - travel + lag),
        p(0, bottom - travel, lateral),
        p(1, bottom - travel - (jump ? 200 : 0)),
      ]),
    );
  if (pen)
    events.splice(4, 0, {...e(2, 300, [{...p(0), toolType: 2}]), toolType: 2});
  events.push(
    e(
      cancel ? 3 : 6,
      620,
      [
        p(0, bottom - 170, lateral),
        p(1, bottom - 170),
        p(2, bottom - 170 + lag),
      ],
      1,
    ),
  );
  events.push(
    e(6, 690, [p(2, bottom - 170 + lag), p(0, bottom - 170, lateral)], 0),
  );
  events.push(e(1, 750, [p(0, bottom - 170, lateral)]));
  return events;
}
function classifier() {
  const c = new StrictEdgeSwipe();
  c.setDimensions(1404, 1872);
  return c;
}
const launchCount = (c, events, blocked = false) =>
  events.reduce((count, e) => count + Number(c.feed(e, true, blocked)), 0);

test('three coherent pointer IDs survive array reordering and staggered release; launch once on final UP', () => {
  const c = classifier();
  const events = trace();
  for (const e of events.slice(0, -1)) assert.equal(c.feed(e), false);
  assert.equal(c.feed(events.at(-1)), true);
  assert.equal(c.feed(events.at(-1)), false);
});
test('missing physical display bounds and rotated bounds fail closed', () => {
  assert.equal(launchCount(new StrictEdgeSwipe(), trace()), 0);
  const c = classifier();
  c.setDimensions(1872, 1404);
  assert.equal(launchCount(c, trace()), 0);
  assert.equal(launchCount(c, trace({bottom: 1370})), 1);
});
test('two fingers, a fourth contact, pen/palm tools and uneven travel cannot launch', () => {
  for (const events of [
    trace({fourth: true}),
    trace({pen: true}),
    trace({lag: 90}),
    trace().map(e => ({
      ...e,
      pointers: e.pointers.filter(p => p.pointerId !== 42),
      pointerCount: e.pointers.filter(p => p.pointerId !== 42).length,
    })),
  ]) {
    assert.equal(launchCount(classifier(), events), 0);
  }
});
test('cancellation, mid-page start, lateral drag and discontinuous coordinates reject without recovery', () => {
  for (const opts of [
    {cancel: true},
    {bottom: 1600},
    {lateral: 55},
    {jump: true},
  ])
    assert.equal(launchCount(classifier(), trace(opts)), 0);
});
test('pen cooldown persists across aborted sessions; clean later swipe works', () => {
  const c = classifier();
  c.feed({
    action: 0,
    eventTime: 4900,
    pointers: [{pointerId: 0, x: 100, y: 100, toolType: 2}],
    pointerCount: 1,
    toolType: 2,
  });
  assert.equal(launchCount(c, trace()), 0);
  assert.equal(launchCount(c, trace({start: 7000})), 1);
  assert.equal(launchCount(c, trace({start: 8000})), 0);
});
test('unknown pointer IDs, duplicate IDs, inconsistent counts and backwards event times fail closed', () => {
  for (const alter of [
    e => ({...e, pointerCount: e.pointerCount + 1}),
    e => ({...e, pointers: e.pointers.map(p => ({...p, pointerId: 1}))}),
    e => ({
      ...e,
      pointers: e.pointers.map(p => ({...p, pointerId: undefined})),
    }),
    e => ({...e, eventTime: 4800}),
  ]) {
    const events = trace();
    events[4] = alter(events[4]);
    assert.equal(launchCount(classifier(), events), 0);
  }
});
test('disabled, view-open and action-in-progress streams do not launch or leave a resumable gesture', () => {
  const c = classifier();
  const events = trace();
  assert.equal(launchCount(c, events, true), 0);
  assert.equal(
    events.some(e => c.feed(e, false)),
    false,
  );
  assert.equal(launchCount(c, trace({start: 9000})), 1);
});
test('early lift cannot count subsequent one-finger travel; late assembly and slow releases reject', () => {
  const early = trace();
  early[3] = {...early[3], action: 6, actionIndex: 2};
  assert.equal(launchCount(classifier(), early), 0);
  const late = trace();
  late[2].eventTime += 300;
  assert.equal(launchCount(classifier(), late), 0);
  const release = trace();
  release.at(-1).eventTime += 300;
  assert.equal(launchCount(classifier(), release), 0);
});


test('two-finger bottom swipe works with stable IDs and staggered lifts', () => {
  const swipe = new StrictEdgeSwipe(); swipe.setDimensions(1404, 1872);
  const points = (travel, count=2) => Array.from({length: count}, (_, i) => ({pointerId: i+10, toolType: 1, x: 500+i*65, y: 1830-travel}));
  const event = (action, time, travel, count=2, actionIndex=0) => ({action, eventTime: time, toolType: 1, pointers: points(travel,count), pointerCount:count, actionIndex});
  for (const e of [event(0,5000,0,1), event(5,5070,0,2,1), event(2,5250,55), event(2,5400,110), event(2,5550,170), event(6,5620,170,2,1)]) assert.equal(swipe.feed(e), false);
  assert.equal(swipe.feed(event(1,5700,170,1)), true);
});
