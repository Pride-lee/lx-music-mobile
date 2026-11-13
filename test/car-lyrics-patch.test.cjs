const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { patches, patchSource } = require('../scripts/patch-car-lyrics.cjs')

const root = path.join(__dirname, '..')
const dependency = process.env.TRACK_PLAYER_SOURCE_DIR || path.join(root, 'node_modules/react-native-track-player')

for (const patch of patches) {
  const source = fs.readFileSync(path.join(dependency, patch.file), 'utf8').replace(/\r\n/g, '\n')
  let original = source
  for (const [before, after] of [...patch.replacements].reverse()) original = original.replace(after, before)

  test(`${path.basename(patch.file)}: applies to the pinned native source and is idempotent`, () => {
    const patched = patchSource(original, patch)
    for (const [, after] of patch.replacements) assert.ok(patched.includes(after))
    assert.equal(patchSource(patched, patch), patched)
    assert.match(patched, /ucar\.media\.metadata\.LYRICS_LINE/)
    assert.match(patched, /ucar\.media\.metadata\.LYRICS_WHOLE/)
    assert.match(patched, /android\.media\.metadata\.LYRICS/)
  })

  test(`${path.basename(patch.file)}: preserves Windows line endings`, () => {
    const patched = patchSource(original.replace(/\n/g, '\r\n'), patch)
    assert.ok(patched.includes('\r\n'))
    assert.equal(patched.replace(/\r\n/g, '').includes('\n'), false)
    assert.equal(patchSource(patched, patch), patched)
  })

  test(`${path.basename(patch.file)}: fails loudly when upstream changes or duplicates an anchor`, () => {
    const [before] = patch.replacements[0]
    assert.throws(() => patchSource(original.replace(before, ''), patch), /does not match/)
    assert.throws(() => patchSource(`${original}\n${before}`, patch), /does not match/)
  })
}

test('native patches are installed automatically for both package channels', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.postinstall, 'node dependencies-patch.js')
  const entry = fs.readFileSync(path.join(root, 'dependencies-patch.js'), 'utf8')
  assert.match(entry, /patchCarLyrics/)
  assert.match(entry, /process\.exitCode = 1/)
  const workflow = fs.readFileSync(path.join(root, '.github/actions/setup/action.yml'), 'utf8')
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npm run test:car-lyrics/)
})
