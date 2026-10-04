// Exercise the actual installed Vercel/OpenAI SDK with the RN buffered-fetch
// response shape. No external network calls or real keys are used.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalFetch = global.fetch;
function compiled(file, overrides = {}) {
  const filename = path.resolve(__dirname, file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, filename);
  return mod.exports;
}
const {providerFetch} = compiled('../src/batch/fetch.ts');
const {refineBatch, refinementError} = compiled('../src/batch/refine.ts', {
  './fetch': {providerFetch},
  '../utils/config': {loadConfig: async () => ({aiApiKey: 'test-only-key', aiModel: 'gpt-4.1-mini'})},
  '../utils/permissions': {ensurePermissionGroup: async () => true},
});
const proposal = {tasks: [{content: 'Call Ofer', description: '', priority: 1, sectionId: null, projectId: null, dueDate: null, labels: []}]};
function bufferedResponse(text, status = 200) {
  return {ok: status < 400, status, statusText: 'test', headers: new Headers({'content-type': 'application/json'}),
    body: null, text: async () => text};
}
test('same Responses model path parses HTTP 200 buffered response and requests strict structured output', async () => {
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({url, init, body: JSON.parse(init.body)});
    return bufferedResponse(JSON.stringify({id: 'resp_test', object: 'response', created_at: 1,
      model: 'gpt-4.1-mini', status: 'completed', output: [{id: 'msg_test', type: 'message', role: 'assistant',
        status: 'completed', content: [{type: 'output_text', text: JSON.stringify(proposal), annotations: []}]}],
      usage: {input_tokens: 20, output_tokens: 40, total_tokens: 60}, incomplete_details: null}));
  };
  try {
    const rows = [{...proposal.tasks[0], dueString: ''}];
    const result = await refineBatch(rows, [], new Date(2026, 9, 3).getTime(), 'aGVsbG8=', new AbortController().signal);
    assert.equal(result[0].content, 'Call Ofer'); assert.equal(result[0].selected, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.text.format.type, 'json_schema');
    assert.equal(requests[0].body.text.format.strict, true);
    assert.ok(requests[0].body.text.format.schema.properties.tasks.items.required.includes('sectionId'));
    assert.match(JSON.stringify(requests[0].body.input), /input_image/);
  } finally {global.fetch = originalFetch;}
});
test('cancelled refinement never starts a request; provider failures hide raw response bodies', async () => {
  let calls = 0;
  global.fetch = async () => {calls++; return bufferedResponse('{"error":{"message":"sensitive-body","type":"invalid_request_error"}}', 401);};
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(refineBatch([], [], Date.now(), undefined, controller.signal), /cancelled/);
    assert.equal(calls, 0);
    let failure;
    try {await refineBatch([], [], Date.now(), undefined, new AbortController().signal);} catch (error) {failure = error;}
    assert.equal(calls, 1); assert.match(refinementError(failure), /rejected the key/);
    assert.doesNotMatch(refinementError(failure), /sensitive-body/);
  } finally {global.fetch = originalFetch;}
});
test('buffered fetch checks oversized output and abort before fabricating a response stream', async () => {
  global.fetch = async () => bufferedResponse('x'.repeat(2 * 1024 * 1024 + 1));
  try {await assert.rejects(providerFetch('test'), /too large/);} finally {global.fetch = originalFetch;}
});
