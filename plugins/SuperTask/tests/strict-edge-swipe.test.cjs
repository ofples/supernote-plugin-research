const {test} = require('node:test');
const assert = require('node:assert/strict');
const {StrictEdgeSwipe} = require('../src/launcher/strictEdgeSwipe.cjs');

function trace({
  ids = [17, 3],
  third = false,
  lateral = 0,
  lag = 0,
  jump = false,
  cancel = false,
  start = 5000,
  bottom = 1830,
  secondBottom = bottom,
  pen = false,
  assembly = 70,
  downsampled = false,
  spacing = 65,
} = {}) {
  const p = (i, y = bottom, xShift = 0) => ({
    pointerId: ids[i],
    toolType: 1,
    x: 500 + i * spacing + xShift,
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
  const events = [e(0, 0, [p(0)])];
  if (ids.length > 1) events.push(e(5, assembly, [p(0), p(1, secondBottom)], 1));
  if (third) events.push(e(5, assembly + 20,
    [p(0), p(1), {pointerId: 99, toolType: 1, x: 700, y: bottom}], 2));
  const steps = downsampled
    ? [[assembly + 180, 85], [assembly + 380, 170]]
    : [[assembly + 180, 55], [assembly + 330, 110], [assembly + 480, 170]];
  for (const [offset, travel] of steps) {
    const order = travel === 110 ? ids.map((_, i) => ids.length - i - 1) : ids.map((_, i) => i);
    const pointers = order.map(i => p(i,
      (i === 1 ? secondBottom : bottom) - travel + (i === 1 ? lag : 0) - (jump && i === 1 ? 200 : 0),
      i === 0 ? lateral : 0));
    events.push(e(2, offset, pointers));
  }
  if (pen)
    events.splice(2, 0, {...e(2, assembly + 220, [{...p(0), toolType: 2}]), toolType: 2});
  const finalTravel = 170;
  const releaseAt = steps[steps.length - 1][0] + 70;
  if (cancel) return [...events, e(3, releaseAt, ids.map((_, i) => p(i, (i === 1 ? secondBottom : bottom) - finalTravel)))];
  if (ids.length > 1) events.push(e(6, releaseAt, ids.map((_, i) => p(i, (i === 1 ? secondBottom : bottom) - finalTravel)), 1));
  events.push(e(1, releaseAt + 70, [p(0, bottom - finalTravel, lateral)]));
  return events;
}
function classifier() {
  const c = new StrictEdgeSwipe();
  c.setDimensions(1404, 1872);
  return c;
}
const launchCount = (c, events, blocked = false) =>
  events.reduce((count, e) => count + Number(c.feed(e, true, blocked)), 0);

test('two coherent pointer IDs survive array reordering and staggered release; launch once on final UP', () => {
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
test('one finger, a third contact, pen tools, wide spacing and uneven travel cannot launch', () => {
  for (const [name, events] of [
    ['one finger', trace({ids: [17]})],
    ['third contact', trace({third: true})],
    ['pen', trace({pen: true})],
    ['uneven travel', trace({lag: 90})],
    ['wide spacing', trace({spacing: 300})],
  ]) {
    assert.equal(launchCount(classifier(), events), 0, name);
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
  late[1].eventTime = 5510;
  assert.equal(launchCount(classifier(), late), 0);
  const release = trace();
  release.at(-1).eventTime += 300;
  assert.equal(launchCount(classifier(), release), 0);
});

test('staggered finger lands at 490ms near the wider edge zone; two sampled moves still launch', () => {
  const events = trace({assembly: 490, bottom: 1740, downsampled: true});
  assert.equal(launchCount(classifier(), events), 1);
});

test('assembly after 500ms, second finger outside the edge zone and widely separated contacts reject', () => {
  assert.equal(launchCount(classifier(), trace({assembly: 510})), 0);
  assert.equal(launchCount(classifier(), trace({secondBottom: 1600})), 0);
  assert.equal(launchCount(classifier(), trace({spacing: 300})), 0);
});


test('two-finger bottom swipe works with stable IDs and staggered lifts', () => {
  const swipe = new StrictEdgeSwipe(); swipe.setDimensions(1404, 1872);
  const first = {pointerId: 10, toolType: 1, x: 500, y: 1830};
  const second = {pointerId: 11, toolType: 1, x: 565, y: 1830};
  const event = (action, time, travel, pointers, actionIndex=0) => ({action, eventTime: time, toolType: 1,
    pointers: pointers.map(p => ({...p, y: 1830 - travel})), pointerCount: pointers.length, actionIndex});
  for (const e of [event(0,5000,0,[first]), event(5,5070,0,[first,second],1),
    event(2,5250,55,[second,first]), event(2,5400,110,[first,second]),
    event(2,5550,170,[first,second]), event(6,5620,170,[first,second],1)]) assert.equal(swipe.feed(e), false);
  assert.equal(swipe.feed(event(1,5690,170,[first])), true);
});
