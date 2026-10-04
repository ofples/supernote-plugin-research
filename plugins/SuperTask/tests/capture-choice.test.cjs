const {test} = require('node:test');
const assert = require('node:assert/strict');
const {captureChoice} = require('../src/batch/captureChoice');
function setup() {const reviews = [], statuses = []; return {reviews, statuses,
  choice: captureChoice({review: v => reviews.push(v), status: v => statuses.push(v)})};}
test('requested AI wins even when OCR finishes first', () => {
  const {choice, reviews} = setup(), id = choice.requestAI();
  choice.ocrReady({text: 'device'}); assert.equal(reviews.length, 0);
  choice.aiReady(id, ['ai']); choice.ocrReady({text: 'late'});
  assert.deepEqual(reviews, [{kind: 'ai', value: ['ai']}]);
});
test('cancel uses ready OCR and rejects late AI', () => {
  const {choice, reviews} = setup(), id = choice.requestAI();
  choice.ocrReady({text: 'device'}); choice.useOCR(); choice.aiReady(id, ['late']);
  assert.deepEqual(reviews, [{kind: 'ocr', value: {text: 'device'}}]);
});
test('failed AI waits for OCR; older attempt cannot win', () => {
  const {choice, reviews} = setup(), id = choice.requestAI();
  choice.aiFailed(id, 'Offline'); choice.aiReady(id, ['late']);
  choice.ocrReady({text: 'device'}); assert.equal(reviews[0].kind, 'ocr');
});
test('close prevents either result navigating', () => {
  const {choice, reviews} = setup(), id = choice.requestAI();
  choice.close(); choice.ocrReady({text: 'late'}); choice.aiReady(id, ['late']);
  assert.equal(reviews.length, 0);
});
