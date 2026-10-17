const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {paginateGroups} = require('../src/workspace/boardPagination');
global.IS_REACT_ACT_ENVIRONMENT = true;

function loadBoard() {
  const filename = path.resolve(__dirname, '../src/components/WorkspaceBoard.tsx');
  const mod = new Module(filename, module); mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value},
    FlatList: ({data = [], renderItem, ListEmptyComponent, ListFooterComponent, ...props}) =>
      React.createElement('List', props, ...(data.length ? data.map(item => renderItem({item})) : [ListEmptyComponent]), ListFooterComponent)};
  const normal = mod.require.bind(mod);
  mod.require = name => name === 'react-native' ? native : name === '../utils/useFontScale' ? {useFontScale: () => 1} : normal(name);
  mod._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText, filename);
  return mod.exports.default;
}

const groups = count => Array.from({length: count}, (_, index) => ({key: `group-${index + 1}`, title: `Group ${index + 1}`, tasks: []}));

test('board pagination shows pairs, clamps after group changes, and resets on context changes', async () => {
  assert.deepEqual(paginateGroups(groups(5), 0), {page: 0, pageCount: 3, groups: groups(5).slice(0, 2)});
  assert.deepEqual(paginateGroups(groups(5), 99).groups.map(group => group.title), ['Group 5']);
  assert.equal(paginateGroups([], 99).pageCount, 1);

  const Board = loadBoard(); let tree;
  const render = (contextKey, items, extraData) => React.createElement(Board, {contextKey, groups: items, extraData,
    renderTask: () => null, taskKey: task => task.id});
  await act(async () => {tree = create(render('today', groups(5)));});
  assert.ok(tree.root.findByProps({accessibilityLabel: 'Board page 1 of 3'}));
  assert.equal(tree.root.findByProps({accessibilityLabel: 'Previous board columns'}).props.disabled, true);
  assert.equal(tree.root.findAllByType('List').length, 2, 'each visible lane retains a vertical task list');
  assert.equal(tree.root.findAllByType('List').some(list => list.props.horizontal), false, 'lanes do not scroll horizontally');
  const laneGroup = tree.root.findAllByType('View').find(node => node.props.style?.flexDirection === 'row' && node.props.style?.gap === 8);
  assert.ok(laneGroup);
  const lanes = laneGroup.children.filter(child => child.type === 'View' && child.props.style?.flex === 1);
  assert.equal(lanes.length, 2);

  await act(async () => tree.root.findByProps({accessibilityLabel: 'Next board columns'}).props.onPress());
  await act(async () => tree.root.findByProps({accessibilityLabel: 'Next board columns'}).props.onPress());
  assert.ok(tree.root.findByProps({accessibilityLabel: 'Board page 3 of 3'}));
  assert.equal(tree.root.findByProps({accessibilityLabel: 'Next board columns'}).props.disabled, true);
  await act(async () => tree.update(render('today', groups(5), {sortBy: 'title', showCompleted: true})));
  assert.ok(tree.root.findByProps({accessibilityLabel: 'Board page 3 of 3'}), 'sorting or toggling Completed keeps the current page');
  await act(async () => tree.update(render('today', groups(3))));
  assert.ok(tree.root.findByProps({accessibilityLabel: 'Board page 2 of 2'}), 'removed groups clamp the current page');
  await act(async () => tree.update(render('project:p:collection', groups(3))));
  assert.ok(tree.root.findByProps({accessibilityLabel: 'Board page 1 of 2'}), 'changing tab or grouping context starts at its first page');
  await act(async () => tree.unmount());
});
