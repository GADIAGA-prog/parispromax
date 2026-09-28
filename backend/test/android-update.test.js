const test = require('node:test');
const assert = require('node:assert/strict');
const { androidUpdateAvailable } = require('../../shared/androidUpdate');
test('Android propose uniquement un build officiel strictement plus récent', () => {
 const release = { versionCode: 22, packageName: 'com.parispromax.app' };
 assert.equal(androidUpdateAvailable(release, '21'), true);
 assert.equal(androidUpdateAvailable(release, '22'), false);
 assert.equal(androidUpdateAvailable(release, '23'), false);
 assert.equal(androidUpdateAvailable(release, null), false);
 assert.equal(androidUpdateAvailable({ ...release, packageName: 'other' }, '21'), false);
});
