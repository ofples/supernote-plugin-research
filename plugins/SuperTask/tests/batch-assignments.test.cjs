const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {act, create} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const {makeDefaults, inheritDefaults, initializeProposalRow, changeDefault, editRow, resetRowField, copyOverridesToSplit, replaceSplitParts, mergeOverrides, reconcileRefinement} = require('../src/batch/assignments');

function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText, filename);
  return mod.exports;
}

const row = (id, overrides = {}, selected = true, values = {}) => ({rowId: id, selected, content: `Task ${id}`,
  projectId: 'house', sectionId: 'garden', dueString: '2026-10-04', priority: 1, labels: [], overrides, ...values});

test('batch assignments update included rows field by field and retain independent manual overrides', () => {
  const defaults = makeDefaults({projectId: 'house', sectionId: 'garden'});
  const rows = [row(1), row(2, {dueString: true}, true, {dueString: '2026-10-08'}), row(3, {}, false)];
  const date = changeDefault(rows, defaults, 'dueString', '2026-10-05');
  assert.equal(date.defaults.dueString, '2026-10-05');
  assert.equal(date.rows[0].dueString, '2026-10-05');
  assert.equal(date.rows[1].dueString, '2026-10-08');
  assert.equal(date.rows[2].dueString, '2026-10-04');
  const location = changeDefault(date.rows, date.defaults, 'location', {projectId: 'work', sectionId: null});
  assert.deepEqual([location.rows[0].projectId, location.rows[0].sectionId], ['work', null]);
  assert.deepEqual([location.rows[1].projectId, location.rows[1].sectionId], ['work', null]);
  assert.deepEqual([location.rows[2].projectId, location.rows[2].sectionId], ['house', 'garden']);
  const priority = changeDefault(location.rows, location.defaults, 'priority', 4);
  assert.equal(priority.rows[0].priority, 4);
  assert.deepEqual(changeDefault(priority.rows, priority.defaults, 'labels', ['home']).rows[0].labels, ['home']);
});

test('individual field edits mark overrides and Use batch restores the latest default', () => {
  const defaults = makeDefaults({projectId: 'work', sectionId: 'office', dueString: '2026-10-10', priority: 3, labels: ['home']});
  let value = editRow(row(1), 'location', {projectId: 'house', sectionId: null});
  assert.equal(value.overrides.location, true);
  assert.deepEqual([value.projectId, value.sectionId], ['house', null]);
  value = resetRowField(value, 'location', defaults);
  assert.deepEqual([value.projectId, value.sectionId], ['work', 'office']);
  assert.equal(value.overrides.location, undefined);
  const instructed = {...value, projectId: 'house', sectionId: 'garden', instructions: {location: true}};
  const resetInstruction = resetRowField(instructed, 'location', defaults);
  assert.equal(resetInstruction.instructions.location, undefined);
  assert.deepEqual([resetInstruction.projectId, resetInstruction.sectionId], ['work', 'office']);
  value = editRow(value, 'dueString', '2026-10-11');
  assert.equal(resetRowField(value, 'dueString', defaults).dueString, '2026-10-10');
  value = editRow(value, 'priority', 4);
  assert.equal(resetRowField(value, 'priority', defaults).priority, 3);
  value = editRow(value, 'labels', ['urgent']);
  assert.deepEqual(resetRowField(value, 'labels', defaults).labels, ['home']);
  assert.equal(editRow(row(2), 'content', 'Edited title').fieldProvenance.content, 'manual');
  assert.equal(editRow(row(2), 'description', 'Edited detail').fieldProvenance.description, 'manual');
});

test('a newly added draft inherits the latest batch defaults and begins without manual overrides', () => {
  const current = makeDefaults({projectId: 'work', sectionId: null, dueString: '2026-10-07', priority: 4, labels: ['errand']});
  const added = inheritDefaults({rowId: 12, content: 'New task', selected: true, overrides: {}}, current);
  assert.deepEqual({projectId: added.projectId, sectionId: added.sectionId, dueString: added.dueString,
    priority: added.priority, labels: added.labels, overrides: added.overrides},
  {projectId: 'work', sectionId: null, dueString: '2026-10-07', priority: 4, labels: ['errand'], overrides: {}});
});

test('an initial AI proposal without explicit location inherits the configured default, while an explicit Inbox choice stays Inbox', () => {
  const defaults = makeDefaults({projectId: 'house', sectionId: 'garden'});
  const generic = initializeProposalRow({content: 'Sweep floor', projectId: null, sectionId: null}, defaults);
  assert.deepEqual([generic.projectId, generic.sectionId], ['house', 'garden']);
  const explicit = initializeProposalRow({content: 'Sweep floor', projectId: null, sectionId: null, explicitFields: ['location']}, defaults);
  assert.deepEqual([explicit.projectId, explicit.sectionId], [null, null]);
  assert.equal(explicit.instructions.location, true);
});

test('split rows copy every explicit field override', () => {
  const original = row(8, {location: true, dueString: true, priority: true, labels: true});
  const split = copyOverridesToSplit(original, [{content: 'First'}, {content: 'Second'}]);
  assert.deepEqual(split.map(part => part.overrides), [original.overrides, original.overrides]);
  assert.deepEqual(split.map(part => part.labels), [[], []]);
});

test('split replacement inserts all split rows once and retains the trailing rows', () => {
  const original = [row(1), row(2, {dueString: true}), row(3)];
  const splitParts = [original[0], {...original[1], content: 'Second A'}, {...original[1], content: 'Second B'}, original[2]];
  const result = replaceSplitParts(original, 1, splitParts);
  assert.deepEqual(result.map(item => item.content), ['Task 1', 'Second A', 'Second B', 'Task 3']);
  assert.deepEqual(result.slice(1, 3).map(item => item.overrides), [{dueString: true}, {dueString: true}]);
  assert.equal(result[3].rowId, 3);
});

test('merge combines nonconflicting overrides and rejects conflicting manual choices with guidance', () => {
  const left = row(1, {dueString: true}, true, {dueString: '2026-10-06'});
  const right = row(2, {priority: true}, true, {priority: 4});
  const combined = mergeOverrides(left, right);
  assert.deepEqual(combined.overrides, {dueString: true, priority: true});
  assert.equal(combined.dueString, left.dueString);
  assert.equal(combined.priority, 4);
  assert.throws(() => mergeOverrides(left, row(3, {dueString: true}, true, {dueString: '2026-10-09'})), /different manual date choices.*keep the rows separate/i);
  assert.throws(() => mergeOverrides(row(1, {location: true}, true, {projectId: 'house', sectionId: 'garden'}),
    row(2, {location: true}, true, {projectId: 'work', sectionId: null})), /different manual project or collection choices/i);
  assert.throws(() => mergeOverrides(row(1, {}, true, {projectId: 'house', sectionId: 'garden', instructions: {location: true}}),
    row(2, {}, true, {projectId: 'work', sectionId: null, instructions: {location: true}})), /different explicit project or collection instructions/i);
  const titles = mergeOverrides(row(1, {content: true}, true, {content: 'Edited first'}), row(2, {content: true}, true, {content: 'Edited second'}));
  assert.equal(titles.overrides.content, true);
});

test('AI source row mappings restore manual overrides while retaining proposed fields and stable identity', () => {
  const original = row(10, {location: true, dueString: true}, true, {projectId: 'house', sectionId: 'garden', dueString: '2026-10-07'});
  const proposal = {content: 'Refined task', projectId: 'work', sectionId: null, dueString: '2026-10-12', priority: 4, labels: ['new'],
    sourceRowIds: ['10'], selected: true};
  const [result] = reconcileRefinement([original], [proposal]);
  assert.equal(result.content, 'Refined task');
  assert.deepEqual([result.projectId, result.sectionId], ['house', 'garden']);
  assert.equal(result.dueString, '2026-10-07');
  assert.equal(result.sourceText, 'Task 10');
  assert.equal(result.priority, 4); assert.deepEqual(result.labels, ['new']);
  assert.equal(result.rowId, 10);
  assert.deepEqual(result.overrides, {location: true, dueString: true});
});

test('manual title and description survive AI refinement and explicit AI metadata resists later batch defaults', () => {
  const source = row(30, {content: true, description: true}, true, {content: 'My edited title', description: 'Keep these details'});
  const [result] = reconcileRefinement([source], [{content: 'AI title', description: 'AI description', projectId: 'house', sectionId: 'garden',
    dueString: '', priority: 4, labels: [], sourceRowIds: ['30'], explicitFields: ['priority']}]);
  assert.equal(result.content, 'My edited title');
  assert.equal(result.description, 'Keep these details');
  assert.deepEqual(result.fieldProvenance, {content: 'manual', description: 'manual'});
  assert.equal(result.priority, 4);
  assert.equal(result.instructions.priority, true);
  const changed = changeDefault([result], makeDefaults({priority: 1}), 'priority', 2);
  assert.equal(changed.rows[0].priority, 4);
});

test('AI cannot merge rows with incompatible manual overrides or invent source references', () => {
  const rows = [row(1, {dueString: true}, true, {dueString: '2026-10-05'}), row(2, {dueString: true}, true, {dueString: '2026-10-06'})];
  assert.throws(() => reconcileRefinement(rows, [{content: 'Merged', sourceRowIds: ['1', '2']}]), /different manual date choices/i);
  assert.throws(() => reconcileRefinement([row(1, {priority: true})], [{content: 'Bad map', sourceRowIds: ['invented']}]), /invalid row mapping/i);
  assert.throws(() => reconcileRefinement([row(1, {priority: true}), row(2)], [{content: 'Lost map'}]), /could not map.*manual choices/i);
});

test('AI refinement keeps manual text and excluded rows, omits the crop for excluded selection, and Undo restores source rows', async () => {
  let receivedImage = 'not-called'; let receivedRowIds;
  const proposal = {content: 'AI title', description: 'AI description', projectId: 'house', sectionId: null, dueString: '', priority: 4,
    labels: [], selected: true, sourceRowIds: ['A'], explicitFields: []};
  const rn = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
  const BatchAdd = load('../src/screens/BatchAdd.tsx', {
    'react-native': rn,
    '../utils/useFontScale': {useFontScale: () => 1},
    'sn-plugin-lib': {PluginManager: {registerPluginLifeListener: () => ({remove() {}})}},
    '../utils/closePlugin': {closePlugin() {}},
    '../utils/config': {loadConfig: async () => ({postCreateAction: 'prompt', aiApiKey: 'test-key'})},
    '../offline/service': {saveOfflineBatch: async () => []},
    '../batch/refine': {refineBatch: async (rows, _projects, _capturedAt, image) => {receivedImage = image; receivedRowIds = rows.map(item => item.rowId); return [proposal];}, refinementError: () => 'AI error'},
    '../collections/useLocations': {useLocations: projects => ({projects, sections: []})},
    '../components/ProjectPicker': {__esModule: true, default: () => null},
    '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/DatePicker': {__esModule: true, default: () => null},
    '../offline/model': {localDate: () => '2026-10-04'},
  }).default;
  const initial = [
    {rowId: 'A', content: 'Manual title', description: 'Manual description', projectId: 'house', sectionId: null, selected: true,
      priority: 1, dueString: '', labels: [], overrides: {content: true, description: true}},
    {rowId: 'B', content: 'Excluded row', description: '', projectId: 'house', sectionId: null, selected: false, priority: 1, dueString: '', labels: []},
  ];
  let tree;
  await act(async () => {tree = create(React.createElement(BatchAdd, {nav: {}, projects: [{id: 'house', name: 'House'}], initialRows: initial, preview: 'private-image'}));});
  const click = async label => act(async () => {
    const button = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === label));
    button.props.onPress();
    await Promise.resolve();
  });
  await click('Refine with AI');
  assert.deepEqual(receivedRowIds, ['A']);
  assert.equal(receivedImage, undefined);
  assert.deepEqual(tree.root.findAllByType('Input').map(input => input.props.value), ['Manual title', 'Excluded row']);
  await click('Undo refinement');
  assert.deepEqual(tree.root.findAllByType('Input').map(input => input.props.value), ['Manual title', 'Excluded row']);
  await act(async () => tree.unmount());
});

test('refinement can fall back to same-position mapping when cardinality is unchanged and has no overrides', () => {
  const result = reconcileRefinement([row(22)], [{content: 'Edited by AI'}]);
  assert.equal(result[0].rowId, 22);
  assert.deepEqual(result[0].overrides, {});
  assert.deepEqual(result[0].fieldProvenance, {content: 'ai-proposal', description: 'ai-proposal'});
});

test('AI split proposals that cite one source row receive distinct fresh identities', () => {
  const source = row('source');
  const proposals = [
    {content: 'First half', sourceRowIds: ['source'], explicitFields: []},
    {content: 'Second half', sourceRowIds: ['source'], explicitFields: []},
  ];
  const result = reconcileRefinement([source], proposals);
  assert.equal(result[0].rowId, undefined); assert.equal(result[1].rowId, undefined);
});

test('BatchAdd split action inserts split lines once and retains following rows', async () => {
  const rn = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
  const BatchAdd = load('../src/screens/BatchAdd.tsx', {
    'react-native': rn,
    '../utils/useFontScale': {useFontScale: () => 1},
    'sn-plugin-lib': {PluginManager: {registerPluginLifeListener: () => ({remove() {}})}},
    '../utils/closePlugin': {closePlugin() {}},
    '../utils/config': {loadConfig: async () => ({postCreateAction: 'prompt'})},
    '../offline/service': {saveOfflineBatch: async () => []},
    '../batch/refine': {refineBatch: async () => [], refinementError: () => 'AI error'},
    '../collections/useLocations': {useLocations: projects => ({projects, sections: []})},
    '../components/ProjectPicker': {__esModule: true, default: () => null},
    '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/DatePicker': {__esModule: true, default: () => null},
    '../offline/model': {localDate: () => '2026-10-04'},
  }).default;
  const projects = [{id: 'house', name: 'House'}];
  const rows = [
    {rowId: 'first', content: 'First line\nSecond line', projectId: 'house', sectionId: null, selected: true, priority: 1, dueString: '', labels: [], description: ''},
    {rowId: 'tail', content: 'Tail row', projectId: 'house', sectionId: null, selected: true, priority: 1, dueString: '', labels: [], description: ''},
  ];
  let tree;
  await act(async () => {tree = create(React.createElement(BatchAdd, {nav: {}, projects, initialRows: rows}));});
  const split = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Split lines'));
  await act(async () => split.props.onPress());
  assert.deepEqual(tree.root.findAllByType('Input').map(input => input.props.value), ['First line', 'Second line', 'Tail row']);
  await act(async () => tree.unmount());
});

test('BatchAdd merge action keeps the joined titles when both rows were manually edited', async () => {
  const rn = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
  const BatchAdd = load('../src/screens/BatchAdd.tsx', {
    'react-native': rn, 'sn-plugin-lib': {PluginManager: {registerPluginLifeListener: () => ({remove() {}})}},
    '../utils/useFontScale': {useFontScale: () => 1},
    '../utils/closePlugin': {closePlugin() {}}, '../utils/config': {loadConfig: async () => ({postCreateAction: 'prompt'})},
    '../offline/service': {saveOfflineBatch: async () => []}, '../batch/refine': {refineBatch: async () => [], refinementError: () => 'AI error'},
    '../collections/useLocations': {useLocations: projects => ({projects, sections: []})},
    '../components/ProjectPicker': {__esModule: true, default: () => null}, '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/DatePicker': {__esModule: true, default: () => null}, '../offline/model': {localDate: () => '2026-10-04'},
  }).default;
  const projects = [{id: 'house', name: 'House'}];
  const rows = [
    {rowId: 'A', content: 'Edited first', description: '', projectId: 'house', sectionId: null, selected: true, priority: 1, dueString: '', labels: [], overrides: {content: true}},
    {rowId: 'B', content: 'Edited second', description: '', projectId: 'house', sectionId: null, selected: true, priority: 1, dueString: '', labels: [], overrides: {content: true}},
  ];
  let tree;
  await act(async () => {tree = create(React.createElement(BatchAdd, {nav: {}, projects, initialRows: rows}));});
  const merge = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Merge next'));
  await act(async () => merge.props.onPress());
  assert.deepEqual(tree.root.findAllByType('Input').map(input => input.props.value), ['Edited first Edited second']);
  await act(async () => tree.unmount());
});

test('BatchAdd scales text and inputs while keeping batch controls reachable outside the row scroller', async () => {
  for (const scale of [1.5, 2]) {
    let styles;
    const rn = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => (styles = value)}};
    const BatchAdd = load('../src/screens/BatchAdd.tsx', {
      'react-native': rn, '../utils/useFontScale': {useFontScale: () => scale},
      'sn-plugin-lib': {PluginManager: {registerPluginLifeListener: () => ({remove() {}})}},
      '../utils/closePlugin': {closePlugin() {}}, '../utils/config': {loadConfig: async () => ({postCreateAction: 'prompt'})},
      '../offline/service': {saveOfflineBatch: async () => []}, '../batch/refine': {refineBatch: async () => [], refinementError: () => 'AI error'},
      '../collections/useLocations': {useLocations: projects => ({projects, sections: []})},
      '../components/ProjectPicker': {__esModule: true, default: () => null}, '../components/PriorityPicker': {__esModule: true, default: () => null},
      '../components/DatePicker': {__esModule: true, default: () => null}, '../offline/model': {localDate: () => '2026-10-04'},
    }).default;
    let tree;
    await act(async () => {tree = create(React.createElement(BatchAdd, {nav: {}, projects: [{id: 'house', name: 'House'}], initialContent: 'A review row'}));});
    const texts = tree.root.findAllByType('Text');
    assert.equal(texts.find(node => node.props.children === 'Review tasks').props.style[1].fontSize, 24 * scale);
    assert.equal(tree.root.findAllByType('Input')[0].props.style[1].fontSize, 18 * scale);
    assert.equal(texts.find(node => node.props.children === 'Today').props.style[1].fontSize, 16 * scale);
    const dateButton = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Tomorrow'));
    assert.ok(dateButton);
    let parent = dateButton.parent;
    while (parent && parent.type !== 'ScrollView') parent = parent.parent;
    assert.equal(parent, null, 'batch date shortcuts stay reachable outside the row scroller');
    assert.equal(styles.actions.flexWrap, 'wrap');
    assert.equal(styles.header.flexWrap, 'wrap');
    await act(async () => tree.unmount());
  }
});

test('BatchAdd reopens a known pre-commit failure for correction but retries uncertain saves with the same request identity', async () => {
  const rn = {View: 'View', Text: 'Text', TextInput: 'Input', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: {create: value => value}};
  let failure = Object.assign(new Error('Invalid destination'), {uncertainCommit: false});
  const requests = [];
  const BatchAdd = load('../src/screens/BatchAdd.tsx', {
    'react-native': rn, '../utils/useFontScale': {useFontScale: () => 1},
    'sn-plugin-lib': {PluginManager: {registerPluginLifeListener: () => ({remove() {}})}},
    '../utils/closePlugin': {closePlugin() {}}, '../utils/config': {loadConfig: async () => ({postCreateAction: 'prompt'})},
    '../offline/service': {saveOfflineBatch: async (_rows, _context, _time, request) => {requests.push(request); throw failure;}},
    '../batch/refine': {refineBatch: async () => [], refinementError: () => 'AI error'},
    '../collections/useLocations': {useLocations: projects => ({projects, sections: []})},
    '../components/ProjectPicker': {__esModule: true, default: () => null}, '../components/PriorityPicker': {__esModule: true, default: () => null},
    '../components/DatePicker': {__esModule: true, default: () => null}, '../offline/model': {localDate: () => '2026-10-04'},
  }).default;
  let tree;
  await act(async () => {tree = create(React.createElement(BatchAdd, {nav: {}, projects: [{id: 'house', name: 'House'}], initialContent: 'Task'}));});
  const click = label => act(async () => {
    const button = tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === label));
    assert.ok(button, `expected button ${label}`); button.props.onPress(); await Promise.resolve();
  });
  await click('Save 1 task');
  assert.ok(tree.root.findAllByType('Pressable').some(node => node.findAllByType('Text').some(text => text.props.children === 'Save 1 task')));
  assert.equal(tree.root.findByType('Input').props.editable, true);
  assert.match(tree.root.findAllByType('Text').map(node => String(node.props.children)).join(' '), /No tasks were saved/);
  failure = Object.assign(new Error('Storage could not be verified'), {uncertainCommit: true});
  await click('Save 1 task');
  const firstRequest = requests.at(-1);
  assert.ok(tree.root.findAllByType('Pressable').some(node => node.findAllByType('Text').some(text => text.props.children === 'Retry same batch')));
  await click('Retry same batch');
  assert.equal(requests.at(-1), firstRequest, 'uncertain retries retain the exact request identity');
  await act(async () => tree.unmount());
});
