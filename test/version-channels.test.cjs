const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const channels = require('../release-channels.json')

const source = fs.readFileSync(path.join(__dirname, '../src/utils/version.js'), 'utf8')
const abis = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86', 'universal']
const version = '1.9.2'
const repo = 'lx-music-mobile'

async function loadUpdater(applicationId, options = {}) {
  const requests = []
  const downloads = []
  const installs = []
  const stoppedJobs = []
  const availabilityChecks = []
  const removed = []
  const pending = []
  const channel = Object.values(channels).find(item => item.applicationId === applicationId)
  const metadata = { version, desc: 'Release notes', history: [] }
  const release = {
    tag_name: `v${version}${channel?.releaseSuffix ?? ''}`,
    draft: false,
    prerelease: false,
    assets: abis.map((abi, index) => ({
      name: `${repo}-v${version}-${abi}${channel?.releaseSuffix ?? ''}.apk`,
      id: index + 100, state: 'uploaded', size: 100,
      ...(options.digest ? { digest: options.digest } : {}),
    })),
    ...options.release,
  }
  let failedMetadata = false
  const mocks = {
    '@/utils/request': {
      httpGet(url, config, callback) {
        requests.push(url)
        const isRelease = url.startsWith('https://api.github.com/')
        if (isRelease && options.rateLimited) {
          callback(null, { statusCode: options.rateLimited, statusMessage: 'Rate limit exceeded' }, {})
        } else if (isRelease && options.unpublished) {
          callback(null, { statusCode: 404, statusMessage: 'Not Found' }, {})
        } else if (!isRelease && options.failPrimary && url.startsWith('https://raw.githubusercontent.com/')) {
          callback(new Error('Primary mirror unavailable'))
        } else if (!isRelease && options.failFirstMetadata && !failedMetadata) {
          failedMetadata = true
          callback(new Error('Network error'))
        } else {
          callback(null, { statusCode: 200 }, isRelease ? release : metadata)
        }
      },
      async checkUrl(url) {
        availabilityChecks.push(url)
        if (options.headUnavailable) throw new Error('Channel APK is unavailable')
      },
    },
    '../../package.json': { name: repo },
    '../../release-channels.json': { default: channels },
    '@/utils/fs': {
      temporaryDirectoryPath: '/cache',
      stopDownload(jobId) { stoppedJobs.push(jobId) },
      async removeMusicDownloadTarget(file) { removed.push(file) },
      async hash() { return options.actualDigest ?? 'a'.repeat(64) },
      downloadFile(url, savePath, config) {
        const response = options.responses?.[downloads.length] ?? { statusCode: 200, bytesWritten: 100 }
        downloads.push({ url, savePath, ...(config.headers ? { headers: config.headers } : {}) })
        config.begin({
          statusCode: response.statusCode, contentLength: options.contentLength ?? 100,
          headers: options.headers ?? {},
        })
        config.progress({ contentLength: 100, bytesWritten: 100 })
        const promise = options.pending
          ? new Promise((resolve, reject) => pending.push({ resolve, reject }))
          : response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
        return { jobId: downloads.length - 1, promise }
      },
    },
    '@/utils/nativeModules/utils': {
      APP_PACKAGE_NAME: applicationId,
      getSupportedAbis: async() => options.abis ?? ['arm64-v8a'],
      installApk: async(filePath, provider) => {
        installs.push({ filePath, provider })
        if (options.installError) throw new Error(options.installError)
      },
    },
    '@/config/constant': { APP_PROVIDER_NAME: `${applicationId}.provider` },
  }
  const context = vm.createContext({ console })
  const updater = new vm.SourceTextModule(source, { context })
  await updater.link((specifier) => {
    const values = mocks[specifier]
    assert.ok(values, `Unexpected import: ${specifier}`)
    return new vm.SyntheticModule(Object.keys(values), function() {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value)
    }, { context })
  })
  await updater.evaluate()
  return { api: updater.namespace, requests, downloads, installs, stoppedJobs, availabilityChecks, removed, pending }
}

for (const [name, channel] of Object.entries(channels)) {
  test(`${name}: checks its own branch and published release`, async() => {
    const updater = await loadUpdater(channel.applicationId)
    const info = await updater.api.getVersionInfo()
    assert.equal(info.version, version)
    assert.ok(updater.requests[0].includes(`/${channel.updateBranch}/publish/version.json`))
    const apiRequests = updater.requests.filter(url => url.startsWith('https://api.github.com/'))
    if (channel.releaseSuffix) {
      assert.deepEqual(apiRequests, [`https://api.github.com/repos/Pride-lee/${repo}/releases/tags/v${version}${channel.releaseSuffix}`])
    } else {
      assert.deepEqual(apiRequests, [])
    }
  })

  for (const abi of abis) {
    test(`${name}: downloads and installs only its own ${abi} APK`, async() => {
      const updater = await loadUpdater(channel.applicationId, { abis: abi === 'universal' ? ['unknown-abi'] : [abi] })
      const progress = []
      await updater.api.downloadNewVersion(version, (total, current) => progress.push([total, current]))
      assert.equal(updater.installs.length, 0)
      await updater.api.updateApp()
      assert.deepEqual(updater.downloads, [{
        url: `https://github.com/Pride-lee/${repo}/releases/download/v${version}${channel.releaseSuffix}/${repo}-v${version}-${abi}${channel.releaseSuffix}.apk`,
        savePath: `/cache/${channel.applicationId}-update.apk`,
      }])
      assert.deepEqual(updater.installs, [{
        filePath: `/cache/${channel.applicationId}-update.apk`,
        provider: `${channel.applicationId}.provider`,
      }])
      assert.deepEqual(progress, [[0, 0], [100, 0], [100, 100]])
    })
  }
}

for (const name of ['luna', 'kuwo']) {
  const channel = channels[name]
  const other = channels[name === 'luna' ? 'kuwo' : 'luna']

  test(`${name}: never accepts the other channel's release`, async() => {
    const updater = await loadUpdater(channel.applicationId, {
      release: { tag_name: `v${version}${other.releaseSuffix}` },
    })
    await assert.rejects(updater.api.getVersionInfo(), /Update channel release is unavailable/)
    assert.ok(updater.requests.every(url => !url.includes(other.releaseSuffix)))
    assert.equal(updater.downloads.length, 0)
  })

  test(`${name}: rejects APKs belonging to the other channel`, async() => {
    const updater = await loadUpdater(channel.applicationId, {
      release: { assets: abis.map(abi => ({ name: `${repo}-v${version}-${abi}${other.releaseSuffix}.apk` })) },
    })
    await assert.rejects(updater.api.getVersionInfo(), /Update channel APKs are unavailable/)
  })

  test(`${name}: does not fall back to another release when unpublished`, async() => {
    const updater = await loadUpdater(channel.applicationId, { unpublished: true })
    await assert.rejects(updater.api.getVersionInfo())
    const releaseRequests = updater.requests.filter(url => url.startsWith('https://api.github.com/'))
    assert.ok(releaseRequests.length > 0)
    assert.ok(releaseRequests.every(url => url.endsWith(`v${version}${channel.releaseSuffix}`)))
  })

  for (const status of ['draft', 'prerelease']) {
    test(`${name}: rejects ${status} releases`, async() => {
      const updater = await loadUpdater(channel.applicationId, { release: { [status]: true } })
      await assert.rejects(updater.api.getVersionInfo(), /Update channel release is unavailable/)
    })
  }

  test(`${name}: rejects partially uploaded APK sets`, async() => {
    const updater = await loadUpdater(channel.applicationId, { release: { assets: [] } })
    await assert.rejects(updater.api.getVersionInfo(), /Update channel APKs are unavailable/)
  })

  test(`${name}: request retries retain the same channel`, async() => {
    const updater = await loadUpdater(channel.applicationId, { failFirstMetadata: true })
    await updater.api.getVersionInfo()
    assert.equal(updater.requests[0], updater.requests[1])
    assert.ok(updater.requests.every(url => !url.includes(other.releaseSuffix)))
  })

  test(`${name}: CDN fallback retains its branch and release channel`, async() => {
    const updater = await loadUpdater(channel.applicationId, { failPrimary: true })
    await updater.api.getVersionInfo()
    assert.ok(updater.requests.some(url => url.includes('@xiaomi/publish/version.json')))
    assert.ok(updater.requests.every(url => !url.includes(other.releaseSuffix)))
    assert.ok(updater.requests.filter(url => url.startsWith('https://api.github.com/')).every(url => url.endsWith(channel.releaseSuffix)))
  })

  for (const status of [403, 429]) {
    test(`${name}: API limit ${status} checks only the same channel's APK`, async() => {
      const updater = await loadUpdater(channel.applicationId, { rateLimited: status })
      assert.equal((await updater.api.getVersionInfo()).version, version)
      assert.deepEqual(updater.availabilityChecks, [
        `https://github.com/Pride-lee/${repo}/releases/download/v${version}${channel.releaseSuffix}/${repo}-v${version}-arm64-v8a${channel.releaseSuffix}.apk`,
      ])
      assert.equal(updater.requests.filter(url => url.startsWith('https://api.github.com/')).length, 1)
    })
  }

  test(`${name}: an API limit and missing APK never switch to another channel`, async() => {
    const updater = await loadUpdater(channel.applicationId, { rateLimited: 403, headUnavailable: true })
    await assert.rejects(updater.api.getVersionInfo(), /Channel APK is unavailable/)
    assert.ok(updater.availabilityChecks.length > 0)
    assert.ok(updater.availabilityChecks.every(url => url.endsWith(`${channel.releaseSuffix}.apk`)))
    assert.ok(updater.requests.every(url => !url.includes(other.releaseSuffix)))
  })
}

test('unknown package identities fail closed without requesting or downloading', async() => {
  const updater = await loadUpdater('invalid.example.app')
  await assert.rejects(updater.api.getVersionInfo(), /Unsupported update package/)
  await assert.rejects(updater.api.downloadNewVersion(version), /Unsupported update package/)
  assert.deepEqual(updater.requests, [])
  assert.deepEqual(updater.downloads, [])
})

test('repeated confirmation shares the active download without competing writers', async() => {
  const updater = await loadUpdater(channels.luna.applicationId, { pending: true })
  const first = updater.api.downloadNewVersion(version)
  const second = updater.api.downloadNewVersion(version)
  assert.equal(first, second)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(updater.pending.length, 1)
  updater.pending[0].resolve({ statusCode: 200, bytesWritten: 100 })
  await Promise.all([first, second])
  assert.deepEqual(updater.stoppedJobs, [])
  assert.equal(updater.downloads.length, 1)
  assert.ok(updater.downloads.every(download => download.url.includes(channels.luna.releaseSuffix)))
})

test('network and HTTP failures retry without changing package channel', async() => {
  const updater = await loadUpdater(channels.kuwo.applicationId, {
    responses: [new Error('Network unavailable'), { statusCode: 503, bytesWritten: 0 }],
  })
  await updater.api.downloadNewVersion(version)
  assert.equal(updater.downloads.length, 3)
  assert.equal(updater.downloads[0].url, updater.downloads[1].url)
  assert.match(updater.downloads[2].url, /api\.github\.com\/repos\/Pride-lee\/lx-music-mobile\/releases\/assets\/100$/)
  assert.equal(updater.downloads[2].headers.Accept, 'application/octet-stream')
  assert.equal(updater.installs.length, 0)
  assert.ok(updater.requests.every(url => url.endsWith('-xiaomi-kuwo')))
})

test('missing fallback assets cannot select another channel', async() => {
  const updater = await loadUpdater(channels.luna.applicationId, {
    responses: [new Error('Network unavailable'), new Error('Network unavailable')],
    release: { assets: [{ id: 999, state: 'uploaded', name: `${repo}-v${version}-arm64-v8a-xiaomi-kuwo.apk` }] },
  })
  await assert.rejects(updater.api.downloadNewVersion(version), /Network unavailable/)
  assert.equal(updater.downloads.length, 2)
  await assert.rejects(updater.api.updateApp(), /apk Save Path/)
})

test('non-200, empty, truncated and HTML downloads never become installable', async() => {
  for (const options of [
    { responses: Array(3).fill({ statusCode: 404, bytesWritten: 0 }) },
    { responses: Array(3).fill({ statusCode: 200, bytesWritten: 0 }) },
    { responses: Array(3).fill({ statusCode: 200, bytesWritten: 90 }) },
    { headers: { 'Content-Type': 'text/html' } },
    { headers: { 'Content-Type': 'application/json' } },
  ]) {
    const updater = await loadUpdater(channels.luna.applicationId, options)
    await assert.rejects(updater.api.downloadNewVersion(version))
    await assert.rejects(updater.api.updateApp(), /apk Save Path/)
    assert.equal(updater.installs.length, 0)
    assert.equal(updater.removed.length, 6)
  }
})

test('release asset size and SHA256 are checked when provided by GitHub', async() => {
  const good = await loadUpdater(channels.luna.applicationId, { digest: `sha256:${'a'.repeat(64)}` })
  await good.api.getVersionInfo()
  await good.api.downloadNewVersion(version)
  await good.api.updateApp()
  assert.equal(good.installs.length, 1)
  const bad = await loadUpdater(channels.luna.applicationId, {
    digest: `sha256:${'b'.repeat(64)}`, contentLength: -1,
  })
  await bad.api.getVersionInfo()
  await assert.rejects(bad.api.downloadNewVersion(version), /checksum mismatch/)
  await assert.rejects(bad.api.updateApp(), /apk Save Path/)
})

test('installation errors preserve the completed APK for retry without downloading again', async() => {
  const updater = await loadUpdater(channels.kuwo.applicationId, { installError: 'INSTALL_PERMISSION_REQUIRED' })
  await updater.api.downloadNewVersion(version)
  await assert.rejects(updater.api.updateApp(), /INSTALL_PERMISSION_REQUIRED/)
  await assert.rejects(updater.api.updateApp(), /INSTALL_PERMISSION_REQUIRED/)
  assert.equal(updater.downloads.length, 1)
  assert.equal(updater.installs.length, 2)
})

test('browser fallback uses the installed package release, never latest across channels', async() => {
  for (const channel of Object.values(channels)) {
    const updater = await loadUpdater(channel.applicationId)
    assert.equal(updater.api.getReleasePageUrl(version),
      `https://github.com/Pride-lee/${repo}/releases/tag/v${version}${channel.releaseSuffix}`)
  }
})

test('a failed subsequent download cannot install a stale APK', async() => {
  const updater = await loadUpdater(channels.luna.applicationId, {
    responses: [{ statusCode: 200, bytesWritten: 100 }, ...Array(3).fill(new Error('Offline'))],
  })
  await updater.api.downloadNewVersion(version)
  await assert.rejects(updater.api.downloadNewVersion(version), /Offline/)
  await assert.rejects(updater.api.updateApp(), /apk Save Path/)
})

test('native package identity and provider are not hard-coded', () => {
  const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java'), 'utf8')
  assert.match(native, /constants\.put\("packageName", reactContext\.getPackageName\(\)\)/)
  assert.match(native, /!reactContext\.getPackageName\(\)\.equals\(updatePackage\.packageName\)/)
  const constants = fs.readFileSync(path.join(__dirname, '../src/config/constant.ts'), 'utf8')
  assert.ok(constants.includes('APP_PROVIDER_NAME = `${APP_PACKAGE_NAME}.provider`'))
})
