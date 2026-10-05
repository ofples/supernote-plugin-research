// Exercise Capture itself with actual React hooks and deferred native/provider
// work. No native SDK, provider, network or device operations are executed.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function timers() {
  let identity = 0;
  const pending = new Map();
  return {pending,
    setTimeout(fn, delay) {const id = ++identity; pending.set(id, {fn, delay}); return id;},
    clearTimeout(id) {pending.delete(id);},
    fire(delay) {
      const found = [...pending.entries()].filter(([, timer]) => timer.delay === delay);
      assert.ok(found.length, `expected a ${delay}ms screen timer`);
      for (const [id, timer] of found) {pending.delete(id); timer.fn();}
    },
  };
}
const flush = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
function compile(overrides) {
  const filename = path.resolve(__dirname, '../src/screens/Capture.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  // Only the screen's timers use the deterministic clock; React keeps its own
  // scheduler. This checks the real screen timeout callback without wall waits.
  mod._compile('const {setTimeout, clearTimeout} = require("capture-test-clock");\n' + source, filename);
  return mod.exports.default;
}
function button(tree, label) {
  return tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === label));
}
async function fixture(options = {}) {
  const ocr = deferred(), native = deferred(), ai = deferred(), clock = timers();
  const reviews = [], calls = [], recycled = [], selected = [{type: 0, id: 'native-element'}];
  const config = {aiApiKey: 'test-only-key', defaultProjectId: 'p', defaultSectionId: 's'};
  let listener, removed = 0, closes = 0, tree;
  const failed = () => Promise.reject(new Error('Metadata unavailable'));
  const result = value => Promise.resolve({success: true, result: value});
  const component = compile({
    'capture-test-clock': clock,
    'react-native': {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}},
    'sn-plugin-lib': {PluginCommAPI: {
      getLassoElements: () => result(selected),
      getCurrentFilePath: options.metadataFails ? failed : () => result('/scratch.note'),
      getCurrentPageNum: options.metadataFails ? failed : () => result(2),
      getLassoRect: options.metadataFails ? failed : () => result({left: 1, top: 2, right: 50, bottom: 60}),
    }, PluginDocAPI: {}, PluginManager: {registerPluginLifeListener(value) {listener = value; return {remove() {removed++;}};}}},
    '../utils/closePlugin': {closePlugin() {closes++;}},
    '../utils/config': {loadConfig: async () => config, saveConfig: async () => {}},
    '../api/todoist': {getProjects: options.metadataFails ? failed : async () => [{id: 'p', name: 'House'}]},
    '../offline/service': {offlineData: options.metadataFails ? failed : async () => ({sections: [{id: 's', name: 'Collection', project_id: 'p'}]})},
    '../utils/ocr': {
      recognizeLassoElements(elements, log, settled) {assert.equal(elements, selected); settled(native.promise); return ocr.promise;},
      recycleElements(elements) {recycled.push(elements);},
    },
    '../batch/preview': {capturePreview: async () => 'image-base64'},
    '../batch/refine': {refineBatch(...args) {calls.push(args); return ai.promise;}, refinementError: () => 'Safe provider failure'},
  });
  const nav = {resetTo(screen, props) {reviews.push({screen, props});}, push() {throw new Error('unexpected settings navigation');}};
  await act(async () => {tree = create(React.createElement(component, {mode: 'lasso', nav})); await flush();});
  return {tree, reviews, calls, recycled, selected, ocr, native, ai, clock,
    get closes() {return closes;}, get removed() {return removed;},
    async press(label) {
      const target = button(tree, label); assert.ok(target, `missing button ${label}`);
      await act(async () => {void target.props.onPress(); await flush();});
    },
    async settleOCR(text = 'Device task', settleNative = true) {
      await act(async () => {ocr.resolve({success: true, text}); if (settleNative) native.resolve(); await flush();});
    },
    async settleAI(rows = [{content: 'AI task', projectId: null, sectionId: null}]) {
      await act(async () => {ai.resolve(rows); await flush();});
    },
    async life(state) {await act(async () => {listener.onMsg({state}); await flush();});},
    async dispose() {await act(async () => {tree.unmount(); await flush();});},
  };
}

test('AI image request starts while OCR is pending; successful AI owns review despite late OCR', async () => {
  const f = await fixture();
  try {
    assert.ok(button(f.tree, 'Recognize with AI'));
    await f.press('Recognize with AI');
    assert.equal(f.calls.length, 1, 'request must not wait for native recognition');
    assert.deepEqual(f.calls[0][0], []); assert.equal(f.calls[0][3], 'image-base64');
    assert.equal(f.calls[0][4].aborted, false); assert.equal(f.reviews.length, 0); assert.equal(f.recycled.length, 0);
    await f.settleAI([{content: 'AI title'}]);
    assert.equal(f.reviews.length, 1); assert.equal(f.reviews[0].screen, 'task-batch');
    assert.deepEqual(f.reviews[0].props.initialRows, [{content: 'AI title'}]);
    assert.equal(f.reviews[0].props.initialContent, '');
    assert.deepEqual(f.reviews[0].props.noteContext, {filePath: '/scratch.note', pageNum: 2, bounds: {left: 1, top: 2, right: 50, bottom: 60}});
    await f.settleOCR('Late device title');
    assert.equal(f.reviews.length, 1, 'late OCR cannot replace the requested AI review');
    assert.deepEqual(f.recycled, [f.selected]);
  } finally {await f.dispose();}
});

test('Cancel AI uses cached ready OCR and ignores provider result arriving after cancellation', async () => {
  const f = await fixture();
  try {
    await f.press('Recognize with AI'); await f.settleOCR('Already recognized');
    assert.equal(f.reviews.length, 0, 'requested AI retains priority while OCR is cached');
    await f.press('Cancel AI / Use device OCR');
    assert.equal(f.calls[0][4].aborted, true);
    assert.equal(f.reviews.length, 1); assert.equal(f.reviews[0].props.initialContent, 'Already recognized');
    assert.equal(f.reviews[0].props.initialRows, undefined);
    assert.equal(button(f.tree, 'Cancel AI / Use device OCR'), undefined);
    await f.settleAI([{content: 'Too late'}]); assert.equal(f.reviews.length, 1);
  } finally {await f.dispose();}
});

test('device OCR text reaches review unchanged for deterministic parser handling', async () => {
  const f = await fixture();
  try {
    const transcription = 'feed dogs - one bowl - each';
    await f.settleOCR(transcription);
    assert.equal(f.reviews.length, 1);
    assert.equal(f.reviews[0].props.initialContent, transcription);
    assert.equal(f.calls.length, 0, 'native OCR transcription does not start an AI request');
  } finally {await f.dispose();}
});

test('90 second deadline falls back and releases busy state even if provider ignores abort forever', async () => {
  const f = await fixture();
  try {
    await f.press('Recognize with AI'); await f.settleOCR('Timeout fallback');
    await act(async () => {f.clock.fire(90000); await flush();});
    assert.equal(f.calls[0][4].aborted, true);
    assert.equal(f.reviews.length, 1); assert.equal(f.reviews[0].props.initialContent, 'Timeout fallback');
    assert.equal(button(f.tree, 'Cancel AI / Use device OCR'), undefined, 'busy state cannot depend on provider settlement');
    assert.ok(button(f.tree, 'Recognize with AI'));
    await f.settleAI([{content: 'Provider ignored deadline'}]); assert.equal(f.reviews.length, 1);
  } finally {await f.dispose();}
});

test('metadata failures cannot prevent device OCR review and do not invent a source backlink', async () => {
  const f = await fixture({metadataFails: true});
  try {
    await f.settleOCR('Review despite metadata failures');
    assert.equal(f.reviews.length, 1); const props = f.reviews[0].props;
    assert.equal(props.initialContent, 'Review despite metadata failures');
    assert.deepEqual(props.projects, []); assert.deepEqual(props.sections, []);
    assert.equal(props.noteContext, undefined); assert.equal(props.defaultProjectId, null);
    assert.equal(f.recycled.length, 1);
  } finally {await f.dispose();}
});

test('AI failure before OCR is ready retains native fallback and late success cannot win', async () => {
  const f = await fixture();
  try {
    await f.press('Recognize with AI');
    await act(async () => {f.ai.reject(new Error('Provider unavailable')); await flush();});
    assert.equal(f.reviews.length, 0); assert.equal(button(f.tree, 'Cancel AI / Use device OCR'), undefined);
    await f.settleOCR('Fallback after AI error');
    assert.equal(f.reviews.length, 1); assert.equal(f.reviews[0].props.initialContent, 'Fallback after AI error');
  } finally {await f.dispose();}
});

test('lifecycle Stop blocks late results; native elements stay alive until native promise settles', async () => {
  const f = await fixture();
  try {
    await f.press('Recognize with AI'); await f.life(3);
    assert.equal(f.calls[0][4].aborted, true);
    await f.settleAI([{content: 'Background result'}]); await f.settleOCR('Background OCR', false);
    assert.equal(f.reviews.length, 0); assert.equal(f.recycled.length, 0);
    await act(async () => {f.native.resolve(); await flush();});
    assert.deepEqual(f.recycled, [f.selected]);
  } finally {await f.dispose();}
  assert.equal(f.removed, 1);
});

test('explicit Capture Cancel closes plugin and prevents either late result from opening review', async () => {
  const f = await fixture();
  try {
    await f.press('Recognize with AI'); await f.press('Cancel');
    assert.equal(f.closes, 1); assert.equal(f.calls[0][4].aborted, true);
    await f.settleAI(); await f.settleOCR(); assert.equal(f.reviews.length, 0);
  } finally {await f.dispose();}
});
