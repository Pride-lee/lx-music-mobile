const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const { patchSource } = require('../scripts/patch-car-lyrics.cjs')
const { patch } = require('../scripts/patch-download-timeouts.cjs')
const root = path.join(__dirname, '..')

function setup(options = {}) {
  const state = { versionInfo: { status: 'idle', newVersion: { version: '1.9.5' }, errorMessage: '' } }
  let downloads = 0
  let installs = 0
  let finishDownload
  const mocks = {
    '@/utils': { compareVer() {} },
    '@/utils/version': {
      async downloadNewVersion(version, progress) {
        downloads++
        progress(100, 50)
        if (options.pending) await new Promise(resolve => { finishDownload = resolve })
        if (options.downloadError) throw new Error(options.downloadError)
      },
      async updateApp() {
        installs++
        if (options.installError) throw Object.assign(new Error(options.installError), { code: options.installError })
      },
    },
    '@/store/version/action': { default: {
      setVersionInfo(info) { Object.assign(state.versionInfo, info) },
      setProgress(info) { state.progress = info },
    } },
    '@/store/version/state': { default: state },
    '@/utils/data': {},
    '@/navigation': {},
    'react-native-navigation': {},
    '@/utils/tools': {},
  }
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/core/version.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, {
    exports, Error, console,
    require(name) { assert.ok(name in mocks, name); return mocks[name] },
  })
  return { api: exports, state, downloads: () => downloads, installs: () => installs, finish: () => finishDownload() }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('update download errors display the actual reason and never launch installation', async() => {
  const updater = setup({ downloadError: 'HTTP 403' })
  updater.api.downloadUpdate()
  await tick()
  assert.equal(updater.state.versionInfo.status, 'error')
  assert.equal(updater.state.versionInfo.errorMessage, 'HTTP 403')
  assert.equal(updater.installs(), 0)
})

test('installation failure retains downloaded status and retries installation only', async() => {
  const updater = setup({ installError: 'INSTALL_PERMISSION_REQUIRED' })
  updater.api.downloadUpdate()
  await tick()
  assert.equal(updater.state.versionInfo.status, 'downloaded')
  assert.equal(updater.state.versionInfo.errorMessage, 'INSTALL_PERMISSION_REQUIRED')
  await updater.api.installUpdate()
  assert.equal(updater.downloads(), 1)
  assert.equal(updater.installs(), 2)
})

test('repeated update button presses start only one transfer and clear previous errors', async() => {
  const updater = setup({ pending: true })
  updater.state.versionInfo.errorMessage = 'old error'
  updater.api.downloadUpdate()
  updater.api.downloadUpdate()
  assert.equal(updater.downloads(), 1)
  assert.equal(updater.state.versionInfo.errorMessage, '')
  updater.finish()
  await tick()
  assert.equal(updater.state.versionInfo.status, 'downloaded')
  assert.equal(updater.installs(), 1)
})

test('invalid or missing APKs allow re-downloading instead of endlessly retrying installation', async() => {
  for (const code of ['APK_INVALID', 'APK_MISSING', 'APK_PACKAGE_MISMATCH']) {
    const updater = setup({ installError: code })
    updater.api.downloadUpdate()
    await tick()
    assert.equal(updater.state.versionInfo.status, 'error')
    assert.equal(updater.state.versionInfo.errorMessage, code)
    updater.api.downloadUpdate()
    await tick()
    assert.equal(updater.downloads(), 2)
  }
})

test('native downloader redirects retain configured connection and read timeouts', () => {
  const source = fs.readFileSync(path.join(root, 'node_modules/react-native-fs', patch.file), 'utf8')
  const [before, after] = patch.replacements[0]
  const original = source.replace(/\r\n/g, '\n').replace(after, before)
  const patched = patchSource(original, patch)
  assert.ok(patched.includes(after))
  assert.equal(patchSource(patched, patch), patched)
  assert.throws(() => patchSource(original.replace(before, ''), patch), /does not match/)
  assert.match(fs.readFileSync(path.join(root, 'dependencies-patch.js'), 'utf8'), /patchDownloadTimeouts/)
})

test('installer distinguishes corrupt APKs, wrong channels and install permission before launch', () => {
  const source = fs.readFileSync(path.join(root, 'android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java'), 'utf8')
  assert.match(source, /if \(updatePackage == null\) \{\s+promise\.reject\("APK_INVALID"/)
  assert.match(source, /!reactContext\.getPackageName\(\)\.equals\(updatePackage\.packageName\)/)
  assert.match(source, /canRequestPackageInstalls\(\)/)
  assert.match(source, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/)
  assert.match(source, /promise\.reject\("INSTALL_PERMISSION_REQUIRED"/)
  assert.match(source, /setDataAndType\(uri, "application\/vnd\.android\.package-archive"\)/)
  assert.match(source, /promise\.reject\("INSTALL_FAILED"/)
})
