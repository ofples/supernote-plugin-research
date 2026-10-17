const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

function makeRuntime({viewport = {top: 0, height: 800, width: 200}, input = {top: 0, height: 40}, inputContentTop = 0, inputContentHeight = input.height, deferMeasureLayout = false, metrics = null, screenHeight = 1872} = {}) {
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
  const dimensions = {get() {return {height: screenHeight};}, addEventListener(_event, callback) {
    const entries = listeners.get('dimensions') || new Set();
    entries.add(callback); listeners.set('dimensions', entries);
    return {remove() {entries.delete(callback); removed.push('dimensions');}};
  }};
  const native = {
    Dimensions: dimensions,
    Keyboard: keyboard,
    Platform: {OS: 'android'},
    View: 'View',
    TextInput: React.forwardRef((props, ref) => {
      const instance = {
        measureInWindow(callback) {callback(0, input.top, 200, input.height);},
        measureLayout(_relativeTo, callback, onFail) {
          if (deferMeasureLayout) pendingMeasureLayoutError = onFail;
          else callback(0, inputContentTop, 200, inputContentHeight);
        },
      };
      React.useImperativeHandle(ref, () => instance);
      return React.createElement('FakeTextInput', props);
    }),
    ScrollView: React.forwardRef((props, ref) => {
      const instance = {
        measureInWindow(callback) {callback(0, viewport.top, viewport.width, viewport.height);},
        getInnerViewRef() {return {};},
        scrollTo(options) {scrolls.push(options);},
      };
      React.useImperativeHandle(ref, () => instance);
      return React.createElement('FakeScrollView', props);
    }),
  };
  const scrolls = [];
  let pendingMeasureLayoutError = null;
  const filename = path.resolve(__dirname, '../src/components/KeyboardAvoidance.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native' ? native : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return {api: mod.exports, native, listeners, removed, scrolls, setMetrics(value) {metrics = value;}, setInputFrame(value) {input = value;}, setInputContentTop(value) {inputContentTop = value;}, failPendingMeasureLayout() {pendingMeasureLayoutError?.();}, dispatch(event, payload) {
    for (const callback of listeners.get(event) || []) callback(payload);
  }};
}

test('keyboard viewport geometry avoids only the overlap that the host did not resize away', () => {
  const {api} = makeRuntime();
  assert.equal(api.calculateKeyboardInset({top: 0, height: 800}, {screenY: 500}), 300);
  assert.equal(api.calculateKeyboardInset({top: 0, height: 500}, {screenY: 500}), 0, 'adjustResize already removed the overlap');
  assert.equal(api.calculateKeyboardInset({top: 300, height: 800}, {screenY: 700}), 400, 'floating PluginHost window uses its screen offset');
  assert.equal(api.calculateKeyboardInset({top: 300, height: 500}, {screenY: 700}), 100, 'partially resized host gets only the remaining overlap');
});

test('keyboard frame normalization repairs only the RN full-screen-bottom error', () => {
  const {api} = makeRuntime();
  assert.deepEqual(api.normalizeKeyboardFrame({screenY: 1872, height: 700}, 1872), {screenY: 1172, height: 700},
    'adjustNothing plus host state bits reports screen bottom instead of keyboard top');
  assert.deepEqual(api.normalizeKeyboardFrame({screenY: 1172, height: 700}, 1872), {screenY: 1172, height: 700},
    'normal adjustResize frame is preserved');
  assert.deepEqual(api.normalizeKeyboardFrame({screenY: 700, height: 400}, 1872), {screenY: 700, height: 400},
    'a modal window frame away from full-screen bottom is preserved');
  assert.deepEqual(api.normalizeKeyboardFrame({screenY: 1872}, 1872), {screenY: 1872},
    'frames without keyboard height are not guessed');
  assert.deepEqual(api.normalizeKeyboardFrame({screenY: 1404, height: 500}, 1404), {screenY: 904, height: 500},
    'screen rotation uses the current height');
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

test('focused input scroll target uses content coordinates when native focus scrolling outruns JS onScroll', () => {
  const {api} = makeRuntime();
  const viewport = {top: 0, height: 500};
  const keyboard = {screenY: 500};
  assert.equal(api.calculateFocusedInputScrollTarget(viewport, {top: 470, height: 50}, 1070, keyboard), 636,
    'absolute content target reveals a clipped field even if JS still thinks scrollY is zero');
  assert.equal(api.calculateFocusedInputScrollTarget(viewport, {top: 200, height: 50}, 800, keyboard), null,
    'an already-visible field does not jump to its content coordinate');
  assert.equal(api.calculateFocusedInputScrollTarget({top: 300, height: 800}, {top: 670, height: 50}, 370, {screenY: 700}), 36,
    'modal bounds still produce a minimal absolute scroll target');
  assert.equal(api.calculateFocusedInputScrollTarget(viewport, {top: 470, height: 0}, 1070, keyboard, 16, 50), 636,
    'stable content height preserves the target even if a clipped screen measurement reports zero height');
});

test('focused host input reveals after keyboard open and listener cleanup is complete', async () => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 1;};
  const runtime = makeRuntime({viewport: {top: 300, height: 800}, input: {top: 670, height: 50}, inputContentTop: 370});
  let tree;
  try {
    let callerFocusCount = 0;
    const callerFocus = () => {callerFocusCount++;};
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null,
      React.createElement(runtime.api.KeyboardAwareTextInput, {accessibilityLabel: 'field', onFocus: callerFocus}),
      React.createElement(runtime.api.KeyboardAwareTextInput, {accessibilityLabel: 'second field'})));});
    const scroll = tree.root.findByType('FakeScrollView');
    const input = tree.root.findAllByType('FakeTextInput')[0];
    await act(async () => input.props.onFocus({nativeEvent: {target: 7}}));
    assert.equal(callerFocusCount, 1, 'the input calls through to the caller focus callback');
    await act(async () => runtime.dispatch('keyboardDidShow', {endCoordinates: {screenY: 700}}));
    assert.deepEqual(runtime.scrolls, [{y: 36, animated: false}], 'uses measured modal and keyboard bounds for a minimal scroll');
    await act(async () => scroll.props.onScroll({nativeEvent: {contentOffset: {y: 36}}}));
    runtime.setInputFrame({top: 690, height: 50});
    runtime.setInputContentTop(426);
    runtime.setMetrics({screenY: 700});
    const secondInput = tree.root.findAllByType('FakeTextInput')[1];
    await act(async () => secondInput.props.onFocus({nativeEvent: {target: 8}}));
    assert.deepEqual(runtime.scrolls, [{y: 36, animated: false}, {y: 92, animated: false}],
      'a new field focused while the keyboard is already visible is also revealed');
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

test('keyboard reveal targets native content position without waiting for the native scroll event', async () => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 1;};
  // A native focus scroll has already advanced the input in content to y=1070,
  // but its onScroll event has not reached JS. The input is still clipped at
  // the keyboard edge and the JS offset remains zero.
  const runtime = makeRuntime({viewport: {top: 0, height: 500}, input: {top: 470, height: 50}, inputContentTop: 1070});
  let tree;
  try {
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null,
      React.createElement(runtime.api.KeyboardAwareTextInput, null)));});
    const input = tree.root.findByType('FakeTextInput');
    await act(async () => input.props.onFocus({nativeEvent: {target: 7}}));
    await act(async () => runtime.dispatch('keyboardDidShow', {endCoordinates: {screenY: 500}}));
    assert.deepEqual(runtime.scrolls, [{y: 636, animated: false}],
      'the target is the absolute content offset, not stale JS offset plus the screen-space delta');
    await act(async () => tree.unmount());
  } finally {
    global.requestAnimationFrame = oldRaf;
  }
});

test('a late native measureLayout failure after unmount cannot scroll the released input', async () => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 1;};
  const runtime = makeRuntime({viewport: {top: 0, height: 500}, input: {top: 470, height: 50}, inputContentTop: 1070, deferMeasureLayout: true});
  let tree;
  try {
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null,
      React.createElement(runtime.api.KeyboardAwareTextInput, null)));});
    const input = tree.root.findByType('FakeTextInput');
    await act(async () => input.props.onFocus({nativeEvent: {target: 7}}));
    await act(async () => runtime.dispatch('keyboardDidShow', {endCoordinates: {screenY: 500}}));
    await act(async () => tree.unmount());
    runtime.failPendingMeasureLayout();
    assert.deepEqual(runtime.scrolls, [], 'fallback checks mount and focus ownership before using native refs');
  } finally {
    global.requestAnimationFrame = oldRaf;
  }
});

test('detaching a focused input clears its scroll owner before later keyboard events', async () => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => {callback(); return 1;};
  const runtime = makeRuntime({viewport: {top: 0, height: 500}, input: {top: 470, height: 50}, inputContentTop: 1070});
  let tree;
  try {
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null,
      React.createElement(runtime.api.KeyboardAwareTextInput, null)));});
    const input = tree.root.findByType('FakeTextInput');
    await act(async () => input.props.onFocus({nativeEvent: {target: 7}}));
    await act(async () => tree.update(React.createElement(runtime.api.KeyboardAwareScrollView, null, null)));
    await act(async () => runtime.dispatch('keyboardDidShow', {endCoordinates: {screenY: 500}}));
    assert.deepEqual(runtime.scrolls, [], 'removed focused rows are no longer measured or scrolled');
    await act(async () => tree.unmount());
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
    await act(async () => {tree = create(React.createElement(runtime.api.KeyboardAwareScrollView, null,
      React.createElement(runtime.api.KeyboardAwareTextInput, null)));});
    const input = tree.root.findByType('FakeTextInput');
    await act(async () => input.props.onFocus({nativeEvent: {target: 7}}));
    assert.deepEqual(runtime.scrolls, [], 'display:none navigation forms are ignored');
    await act(async () => tree.unmount());
  } finally {
    global.requestAnimationFrame = oldRaf;
  }
});

test('every current TextInput surface is accounted for by the shared viewport and focused-scroll path', () => {
  const src = path.resolve(__dirname, '../src');
  const inputFiles = [], rawInputFiles = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = fs.readFileSync(file, 'utf8');
        const relative = path.relative(src, file).replaceAll('\\', '/');
        if (/<KeyboardAwareTextInput\b/.test(source)) inputFiles.push(relative);
        if (/<TextInput\s/.test(source)) rawInputFiles.push(relative);
      }
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
  assert.deepEqual(rawInputFiles, ['components/KeyboardAvoidance.tsx'], 'screen and modal inputs register their native host ref through the shared wrapper');

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
