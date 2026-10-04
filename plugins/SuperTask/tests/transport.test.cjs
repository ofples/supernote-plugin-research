const test = require('node:test');
const assert = require('node:assert/strict');
const {createTransport} = require('../src/offline/transport');

test('Sync uses form commands, frozen credential and full snapshot resource selection', async () => {
  const requests = [];
  const api = createTransport('test-only-token', async (url, options) => {
    requests.push({url, options});
    const body = new URLSearchParams(options.body);
    const resources = JSON.parse(body.get('resource_types'));
    return {ok: true, async json() {
      return resources.includes('user') ? {user: {id: 'user'}} :
        resources.includes('items') ? {full_sync: true, items: [{id: 'a'}, {id: 'b', is_deleted: true}], projects: [], sections: []} :
          {sync_status: {uuid: 'ok'}};
    }};
  }, async () => true);
  assert.equal(await api.userId(), 'user');
  const command = {uuid: 'uuid', type: 'item_add', args: {content: 'A & B'}};
  await api.commands([command]);
  const snapshot = await api.fetchSnapshot();
  assert.equal(snapshot.tasks.length, 1);
  assert.deepEqual(JSON.parse(new URLSearchParams(requests[1].options.body).get('commands')), [command]);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-only-token');
  assert.equal(requests[1].url, 'https://api.todoist.com/api/v1/sync');
});

test('permission denial sends nothing', async () => {
  let calls = 0;
  const api = createTransport('unused', async () => { calls++; }, async () => false);
  await assert.rejects(api.userId(), /not allowed/);
  assert.equal(calls, 0);
});

test('HTTP 429 exposes retry delay and performs no immediate network retry', async () => {
  let calls = 0;
  const api = createTransport('unused', async () => {
    calls++;
    return {ok: false, status: 429, headers: {get: () => '120'}};
  }, async () => true);
  await assert.rejects(api.commands([]), error => error.status === 429 && error.retryAfterMs === 120000);
  assert.equal(calls, 1);
});

test('incomplete full snapshot and missing user identity are errors', async () => {
  const api = createTransport('unused', async () => ({ok: true, json: async () => ({items: [], projects: [], sections: []})}), async () => true);
  await assert.rejects(api.fetchSnapshot(), /incomplete/);
  await assert.rejects(api.userId(), /identify/);
});

test('a full response missing sections cannot discard the cached collection list', async () => {
  const api = createTransport('unused', async () => ({ok: true, json: async () => ({full_sync: true, items: [], projects: []})}), async () => true);
  await assert.rejects(api.fetchSnapshot(), /incomplete/);
});

test('timed requests abort without exposing credentials or error bodies', async () => {
  const api = createTransport('secret', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { const error = new Error('abort'); error.name = 'AbortError'; reject(error); });
  }), async () => true, 10);
  await assert.rejects(api.commands([]), /remain saved locally/);
});
