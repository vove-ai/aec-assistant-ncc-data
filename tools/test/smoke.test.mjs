import { test } from 'node:test';
import assert from 'node:assert/strict';
test('node >= 24', () => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24);
});
