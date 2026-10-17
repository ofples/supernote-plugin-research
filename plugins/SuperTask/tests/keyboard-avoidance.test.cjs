const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

function makeRuntime({viewport = {top: 0, height: 800, width: 200}, input = {top: 0, height: 40}, metrics = null} = {}) {
  const listeners = new Map();
  const removed = [];
  const keyboard = {
    addListener(event, callback) {
      const entries = listeners.get(event) || new Set();
      entries.add(callback); listeners.set(event, entries);
      return {remove() {entries.delete(callback); removed.push(event);}};
    },
    metrics: () => metrics,
    isVisible: () => !!metrics,
  };
  const dimensions = {addEventListener(_event, callback) {
    const entries = listeners.get('dimensions') || new Set();
    entries.add(callback); listeners.set('dimensions', entries);
    return {remove() {entries.delete(callback); removed.push('dimensions');}};
  }};
  const native = {
    Dimensions: dimensions,
    Keyboard: keyboard,
    Platform: {OS: 'android'},
    UIManager: {measureInWindow(target, callback) {callback(0, target === 5 ? viewport.top : input.top, 200, target === 5 ? viewport.height : input.height);}},
    View: 'View',
    ScrollView: React.forwardRef((props, ref) => {
      const instance = {
        measureInWindow(callback) {callback(0, viewport.top, viewport.width, viewport.height);},
        scrollTo(options) {scrolls.push(options);},
      };
      React.useImperativeHandle(ref, () => instance);
      return React.createElement('FakeScrollView', props);
    }),
  };
  const scrolls = [];
  const filename = path.resolve(__dirname, '../src/components/KeyboardAvoidance.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native' ? native : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return {api: mod.exports, native, listeners, removed, scrolls, setMetrics(value) {metrics = value;}};
}

test('keyboard viewport geometry avoids only the overlap that the host did not resize away', () => {
  const {api} = makeRuntime();
  assert.equal(api.calculateKeyboardInset({top: 0, height: 800}, {screenY: 500}), 300);
  assert.equal(api.calculateKeyboardInset({top: 0, height: 500}, {screenY: 500}), 0, 'adjustResize already removed the overlap');
  assert.equal(api.calculateKeyboardInset({top: 300, height: 800}, {screenY: 700}), 400, 'floating PluginHost window uses its screen offset');
  assert.equal(api.calculateKeyboardInset({top: 300, height: 500}, {screenY: 700}), 100, 'partially resized host gets only the remaining overlap');
});

test('focused input scroll delta handles modal offsets, already-visible fields and adjusted host windows', () => {
  const {api} = makeRuntime();
  assert.equal(api.calculateFocusedInputScrollDelta({top: 300, height: 800, scrollY: 0}, {top: 670, height: 50}, {screenY: 700}), 36,
    'screen-space measurements reveal a field inside a modal window');
  assert.equal(api.calculateFocusedInputScrollDelta({top: 300, height: 800, scrollY: 120}, {top: 610, height: 40}, {screenY: 700}), 0,
    'does not jump when a field is already visible');
  assert.equal(api.calculateFocusedInputScrollDelta({top: 0, height: 500, scrollY: 0}, {top: 430, height: 40}, {screenY: 500}), 0,
    'does not apply the keyboard height a second time after host resize');
  assert.equal(api.calculateFocusedInputScrollDelta({top: 100, height: 400, scrollY: 30}, {top: 80, height: 20}, {screenY: 500}), -36,
    'scrolls upward only enough when the field is above the visible viewport');
  assert.equal(api.calculateFocusedInputScrollDelta({top: 0, height: 300, scrollY: 0}, {top: 250, height: 500}, {screenY: 300}), 466,
    'keeps the insertion end of a multiline field visible when it is taller than the viewport');
});

test('keyboard-aware scroll view measures in window coordinates and removes all listeners on unmount', async () => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 1;};
  const runtime = makeRuntime({viewport: {top: 300, height: 800}, input: {top: 670, height: 50}, metrics: {screenY: 700}});
  let tree;
  try {
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null));});
    const scroll = tree.root.findByType('FakeScrollView');
    await act(async () => scroll.props.onFocus({nativeEvent: {target: 7}}));
    assert.deepEqual(runtime.scrolls, [{y: 36, animated: false}], 'uses measured modal and keyboard bounds for a minimal scroll');
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(runtime.listeners.get('keyboardDidShow').size, 1);
    assert.equal(runtime.listeners.get('keyboardDidHide').size, 1);
    assert.equal(runtime.listeners.get('dimensions').size, 1);
    await act(async () => tree.unmount());
    assert.equal(runtime.listeners.get('keyboardDidShow').size, 0);
    assert.equal(runtime.listeners.get('keyboardDidHide').size, 0);
    assert.equal(runtime.listeners.get('dimensions').size, 0);
  } finally {
    global.requestAnimationFrame = oldRaf;
  }
});

test('keyboard events do not scroll an inactive route whose native viewport is hidden', async () => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 1;};
  const runtime = makeRuntime({viewport: {top: 0, height: 0, width: 0}, input: {top: 650, height: 40}, metrics: {screenY: 600}});
  let tree;
  try {
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null));});
    const scroll = tree.root.findByType('FakeScrollView');
    await act(async () => scroll.props.onFocus({nativeEvent: {target: 7}}));
    assert.deepEqual(runtime.scrolls, [], 'display:none navigation forms are ignored');
    await act(async () => tree.unmount());
  } finally {
    global.requestAnimationFrame = oldRaf;
  }
});

test('every current TextInput surface is accounted for by the shared viewport and focused-scroll path', () => {
  const src = path.resolve(__dirname, '../src');
  const inputFiles = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.tsx?$/.test(entry.name) && /<TextInput\b/.test(fs.readFileSync(file, 'utf8'))) inputFiles.push(path.relative(src, file).replaceAll('\\', '/'));
    }
  };
  visit(src);
  assert.deepEqual(inputFiles.sort(), [
    'components/AISettingsFields.tsx',
    'components/InlineTaskComposer.tsx',
    'components/ProjectPicker.tsx',
    'components/settings/index.tsx',
    'screens/BatchAdd.tsx',
    'screens/Config.tsx',
    'screens/QuickAdd.tsx',
    'screens/TaskAdd.tsx',
    'screens/TaskDetail.tsx',
    'screens/TaskHome.tsx',
  ].sort(), 'update this inventory when a new input surface is added');

  const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  assert.match(app, /<KeyboardAvoidanceViewport>/, 'all navigation routes share the host-aware viewport');
  for (const screen of ['BatchAdd', 'Config', 'QuickAdd', 'TaskAdd', 'TaskDetail', 'TaskHome']) {
    const source = fs.readFileSync(path.join(src, 'screens', `${screen}.tsx`), 'utf8');
    assert.match(source, /KeyboardAwareScrollView/, `${screen} keeps focused fields reachable inside its vertical forms`);
  }
  for (const screen of ['BatchAdd', 'TaskHome']) {
    const source = fs.readFileSync(path.join(src, 'screens', `${screen}.tsx`), 'utf8');
    assert.match(source, /KeyboardAvoidanceViewport/, `${screen} input modal has its own viewport`);
  }
});
