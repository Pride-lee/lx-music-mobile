const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const channels = require('../release-channels.json')
const pkg = require('../package.json')

const [command, channelName, aapt] = process.argv.slice(2)
const channel = channels[channelName]
assert.ok(channel, `Unknown release channel: ${channelName}`)

if (command === 'configure') {
  console.log(`PACKAGE_VERSION=${pkg.version}`)
  console.log(`RELEASE_SUFFIX=${channel.releaseSuffix}`)
  console.log(`APPLICATION_ID=${channel.applicationId}`)
} else if (command === 'verify') {
  assert.ok(aapt && fs.existsSync(aapt), 'An Android aapt binary is required')
  const outputDir = path.join(__dirname, '../android/app/build/outputs/apk/release')
  const metadata = JSON.parse(fs.readFileSync(path.join(outputDir, 'output-metadata.json'), 'utf8'))
  const abiCodes = { 'armeabi-v7a': 1, x86: 2, 'arm64-v8a': 3, x86_64: 4 }
  const seen = new Set()
  assert.equal(metadata.applicationId, channel.applicationId)
  assert.equal(metadata.elements.length, 5)
  for (const apk of metadata.elements) {
    const abi = apk.filters.find(filter => filter.filterType === 'ABI')?.value ?? 'universal'
    assert.ok(abi === 'universal' || abiCodes[abi], `Unexpected ABI: ${abi}`)
    assert.ok(!seen.has(abi), `Duplicate ABI: ${abi}`)
    seen.add(abi)
    const versionCode = abi === 'universal' ? pkg.versionCode : pkg.versionCode * 1000 + abiCodes[abi]
    assert.equal(apk.versionCode, versionCode)
    assert.equal(apk.versionName, pkg.version)
    assert.equal(apk.outputFile, `${pkg.name}-v${pkg.version}-${abi}.apk`)
    const apkPath = path.join(outputDir, apk.outputFile)
    const badging = execFileSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' })
    assert.ok(badging.includes(`package: name='${channel.applicationId}' versionCode='${versionCode}' versionName='${pkg.version}'`))
    const manifest = execFileSync(aapt, ['dump', 'xmltree', apkPath, 'AndroidManifest.xml'], { encoding: 'utf8' })
    assert.match(manifest, new RegExp(`android:authorities[^\\n]*"${channel.applicationId.replace(/\./g, '\\.')}\\.provider"`))
  }
  console.log(`Verified ${channelName}: ${channel.applicationId} v${pkg.version}, ${seen.size} APKs`)
} else {
  throw new Error(`Unknown command: ${command}`)
}
