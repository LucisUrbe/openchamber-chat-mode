import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedMajors, supportsMajorVersion, versions } from '../dist/lib/policy.js';

test('only valid major-version 2 releases are accepted, including prerelease and build metadata', () => {
  for (const version of ['2.0.0', '2.5.3', '2.999.42', '2.0.0-beta.1', '2.9.3-01a+build.001']) {
    assert.equal(supportsMajorVersion(version, supportedMajors.opencode), true, version);
    assert.equal(supportsMajorVersion(version, supportedMajors.openchamber), true, version);
  }
  for (const version of ['1.99.99', '3.0.0', '20.1.1', '02.0.0', '2.01.0', '2.0.01', '2.0', '2', 'v2.0.0', '2.0.0-beta.01', '2.0.0+', '2.0.0-foo..bar', '2.0.0 garbage', '', null, 2]) {
    assert.equal(supportsMajorVersion(version, 2), false, String(version));
  }
  assert.deepEqual(versions, { openchamber: '2.7.0', opencode: '2.2.6' });
  assert.notEqual('2.2.6-beta.1', versions.opencode);
  assert.notEqual('2.2.6+custom', versions.opencode);
});
