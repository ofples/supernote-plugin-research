const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('inline composer keeps destination beside calendar with clipped label and full accessibility name', async () => {
  let styles;
  const native = {View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', StyleSheet: {create: value => (styles = value)}};
  const filename = path.resolve(__dirname, '../src/components/InlineTaskComposer.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = request => {
    if (request === 'react-native') return native;
    if (request === './KeyboardAvoidance') return {KeyboardAwareTextInput: 'KeyboardAwareTextInput'};
    if (request === '../utils/useFontScale') return {useFontScale: () => 2};
    return normal(request);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);

  const destinationLabel = 'Home / A very long collection name that must not wrap';
  let tree;
  await act(async () => {tree = create(React.createElement(mod.exports.default, {
    value: '', onChangeText() {}, dueDate: 'Wednesday, October 21, 2026', destinationLabel,
    onChooseDate() {}, onChooseDestination() {}, onSubmit() {},
  }));});

  const buttons = tree.root.findAllByType('Pressable');
  assert.deepEqual(buttons.map(button => button.props.accessibilityLabel), [
    'Choose due date, Wednesday, October 21, 2026',
    `Task destination: ${destinationLabel}. Change destination`,
    'Add task',
  ]);
  const row = tree.root.findByProps({style: styles.inputRow});
  assert.equal(row.props.style.flexDirection, 'row');
  assert.equal(row.props.style.flexWrap, undefined);
  assert.equal(row.findAllByType('Pressable').length, 3);
  const destination = buttons[1];
  assert.equal(destination.props.style, styles.destination);
  assert.equal(styles.destination.minHeight, 48);
  assert.equal(styles.destination.minWidth, 44);
  assert.equal(styles.destination.maxWidth, 104);
  const destinationText = destination.findAllByType('Text')[0];
  assert.equal(destinationText.props.numberOfLines, 1);
  assert.equal(destinationText.props.ellipsizeMode, 'tail');
  assert.equal(destinationText.props.children.trim(), destinationLabel);
  assert.equal(buttons[0].findByType('Text').props.numberOfLines, 1, 'long date labels stay on one line');
  assert.ok(buttons[0].findByType('Text').props.style[0].maxWidth <= 64);
  assert.equal(buttons[2].props.accessibilityLabel, 'Add task', 'Add stays a separate reachable control at large font scale');
  assert.equal(styles.addButton.minHeight, 48);
  await act(async () => tree.unmount());
});
