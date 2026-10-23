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
  const channel = Object.values(channels).find(item => item.applicationId === applicationId)
  const metadata = { version, desc: 'Release notes', history: [] }
  const release = {
    tag_name: `v${version}${channel?.releaseSuffix ?? ''}`,
    draft: false,
    prerelease: false,
    assets: abis.map(abi => ({ name: `${repo}-v${version}-${abi}${channel?.releaseSuffix ?? ''}.apk` })),
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
      downloadFile(url, savePath, config) {
        downloads.push({ url, savePath })
        config.begin({ statusCode: 200, contentLength: 100 })
        config.progress({ contentLength: 100, bytesWritten: 100 })
        return { jobId: downloads.length, promise: Promise.resolve() }
      },
    },
    '@/utils/nativeModules/utils': {
      APP_PACKAGE_NAME: applicationId,
      getSupportedAbis: async() => options.abis ?? ['arm64-v8a'],
      installApk: async(filePath, provider) => { installs.push({ filePath, provider }) },
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
  return { api: updater.namespace, requests, downloads, installs, stoppedJobs, availabilityChecks }
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
      assert.deepEqual(updater.downloads, [{
        url: `https://github.com/Pride-lee/${repo}/releases/download/v${version}${channel.releaseSuffix}/${repo}-v${version}-${abi}${channel.releaseSuffix}.apk`,
        savePath: `/cache/${channel.applicationId}-update.apk`,
      }])
      assert.deepEqual(updater.installs, [{
        filePath: `/cache/${channel.applicationId}-update.apk`,
        provider: `${channel.applicationId}.provider`,
      }])
      assert.deepEqual(progress, [[100, 0], [100, 100]])
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

test('a new download cancels the previous job without switching channel', async() => {
  const updater = await loadUpdater(channels.luna.applicationId)
  await updater.api.downloadNewVersion(version)
  await updater.api.downloadNewVersion(version)
  assert.deepEqual(updater.stoppedJobs, [1])
  assert.ok(updater.downloads.every(download => download.url.includes(channels.luna.releaseSuffix)))
})

test('native package identity and provider are not hard-coded', () => {
  const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java'), 'utf8')
  assert.match(native, /constants\.put\("packageName", reactContext\.getPackageName\(\)\)/)
  assert.match(native, /!reactContext\.getPackageName\(\)\.equals\(updatePackage\.packageName\)/)
  const constants = fs.readFileSync(path.join(__dirname, '../src/config/constant.ts'), 'utf8')
  assert.ok(constants.includes('APP_PROVIDER_NAME = `${APP_PACKAGE_NAME}.provider`'))
})
