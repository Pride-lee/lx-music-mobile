import { checkUrl, httpGet } from '@/utils/request'
import { name } from '../../package.json'
import { downloadFile, hash, removeMusicDownloadTarget, temporaryDirectoryPath } from '@/utils/fs'
import { APP_PACKAGE_NAME, getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'
import releaseChannels from '../../release-channels.json'

// fork：检查更新只看自己的仓库；GitHub 仓库 slug 仍保持 package.json 的 name（lx-music-mobile）
const FORK_OWNER = 'Pride-lee'
const FORK_REPO = name
const releaseAssets = new Map()

const getUpdateChannel = () => {
  const channel = Object.values(releaseChannels).find(channel => channel.applicationId == APP_PACKAGE_NAME)
  if (!channel) throw new Error(`Unsupported update package: ${APP_PACKAGE_NAME}`)
  return channel
}

const getApkDownloadUrl = (version, abi, releaseSuffix) => {
  return `https://github.com/${FORK_OWNER}/${FORK_REPO}/releases/download/v${version}${releaseSuffix}/${FORK_REPO}-v${version}-${abi}${releaseSuffix}.apk`
}

export const getReleasePageUrl = (version) => {
  const { releaseSuffix } = getUpdateChannel()
  return `https://github.com/${FORK_OWNER}/${FORK_REPO}/releases/tag/v${encodeURIComponent(version + releaseSuffix)}`
}

const getRelease = async(version, releaseSuffix) => {
  const tag = `v${version}${releaseSuffix}`
  const release = await request(`https://api.github.com/repos/${FORK_OWNER}/${FORK_REPO}/releases/tags/${encodeURIComponent(tag)}`)
  if (release.tag_name != tag || release.draft || release.prerelease || !Array.isArray(release.assets)) {
    throw new Error('Update channel release is unavailable')
  }
  return release
}

const abis = [
  'arm64-v8a',
  'armeabi-v7a',
  'x86_64',
  'x86',
  'universal',
]

const getVersionAddresses = () => {
  const { updateBranch } = getUpdateChannel()
  return [
    [`https://raw.githubusercontent.com/${FORK_OWNER}/${FORK_REPO}/${updateBranch}/publish/version.json`, 'direct'],
    [`https://cdn.jsdelivr.net/gh/${FORK_OWNER}/${FORK_REPO}@${updateBranch}/publish/version.json`, 'direct'],
    [`https://fastly.jsdelivr.net/gh/${FORK_OWNER}/${FORK_REPO}@${updateBranch}/publish/version.json`, 'direct'],
    [`https://gcore.jsdelivr.net/gh/${FORK_OWNER}/${FORK_REPO}@${updateBranch}/publish/version.json`, 'direct'],
  ]
}


const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        const error = err || Object.assign(new Error(resp.statusMessage || resp.statusCode), { statusCode: resp.statusCode })
        if (error.statusCode == 403 || error.statusCode == 429) {
          reject(error)
          return
        }
        ++retryNum >= 3
          ? reject(error)
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getDirectInfo = async(url) => {
  const info = await request(url)
  if (info.version == null) throw new Error('failed')
  const { releaseSuffix } = getUpdateChannel()
  if (releaseSuffix) {
    const tag = `v${info.version}${releaseSuffix}`
    let release
    try {
      release = await getRelease(info.version, releaseSuffix)
    } catch (error) {
      if (error.statusCode != 403 && error.statusCode != 429) throw error
      // Shared proxy IPs can exhaust the unauthenticated GitHub API quota.
      const abi = await getTargetAbi()
      await checkUrl(getApkDownloadUrl(info.version, abi, releaseSuffix), { timeout: 10000 })
      return info
    }
    if (release.tag_name != tag || release.draft || release.prerelease || !Array.isArray(release.assets)) throw new Error('Update channel release is unavailable')
    if (!abis.every(abi => release.assets.some(asset => asset.name == `${FORK_REPO}-v${info.version}-${abi}${releaseSuffix}.apk`))) {
      throw new Error('Update channel APKs are unavailable')
    }
    releaseAssets.set(tag, release.assets)
  }
  return info
}

const getNpmPkgInfo = async(url) => {
  return request(url).then(json => {
    if (!json.versionInfo) throw new Error('failed')
    const info = JSON.parse(json.versionInfo)
    if (info.version == null) throw new Error('failed')
    return info
  })
}

export const getVersionInfo = async(index = 0) => {
  const address = getVersionAddresses()
  const [url, source] = address[index]
  let promise
  switch (source) {
    case 'direct':
      promise = getDirectInfo(url)
      break
    case 'npm':
      promise = getNpmPkgInfo(url)
      break
  }

  return promise.catch(async(err) => {
    index++
    if (index >= address.length) throw err
    return getVersionInfo(index)
  })
}

const getTargetAbi = async() => {
  const supportedAbis = await getSupportedAbis()
  for (const abi of abis) {
    if (supportedAbis.includes(abi)) return abi
  }
  return abis[abis.length - 1]
}
const noop = (total, download) => {}
let apkSavePath
let downloadTask = null

const runDownload = async(version, onDownload) => {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid update version')
  const { releaseSuffix } = getUpdateChannel()
  const abi = await getTargetAbi()
  const url = getApkDownloadUrl(version, abi, releaseSuffix)
  const savePath = `${temporaryDirectoryPath}/${APP_PACKAGE_NAME}-update.apk`
  const tag = `v${version}${releaseSuffix}`
  const assetName = `${FORK_REPO}-v${version}-${abi}${releaseSuffix}.apk`
  let asset = releaseAssets.get(tag)?.find(item => item.name == assetName)
  let lastError
  apkSavePath = null

  // Retry the release URL, then try GitHub's official asset endpoint only.
  for (let attempt = 0; attempt < 3; attempt++) {
    let downloadUrl = url
    let headers
    if (attempt == 2) {
      try {
        const release = await getRelease(version, releaseSuffix)
        asset = release.assets.find(item => item.name == assetName && item.state == 'uploaded')
        if (!Number.isSafeInteger(asset?.id) || asset.id <= 0) throw new Error('Update channel APK is unavailable')
        downloadUrl = `https://api.github.com/repos/${FORK_OWNER}/${FORK_REPO}/releases/assets/${asset.id}`
        headers = { Accept: 'application/octet-stream', 'User-Agent': FORK_REPO }
      } catch {
        break
      }
    }
    await removeMusicDownloadTarget(savePath)
    onDownload(0, 0)
    let contentLength = 0
    let contentType = ''
    try {
      const { promise } = downloadFile(downloadUrl, savePath, {
        progressInterval: 500,
        connectionTimeout: 30000,
        readTimeout: 60000,
        ...(headers ? { headers } : {}),
        begin(info) {
          contentLength = info.contentLength > 0 ? info.contentLength : 0
          contentType = String(Object.entries(info.headers ?? {}).find(([key]) => key.toLowerCase() == 'content-type')?.[1] ?? '')
          onDownload(contentLength, 0)
        },
        progress({ contentLength, bytesWritten }) {
          onDownload(contentLength > 0 ? contentLength : 0, bytesWritten)
        },
      })
      const result = await promise
      if (result.statusCode != 200) throw new Error(`HTTP ${result.statusCode}`)
      if (/^(?:text\/|application\/(?:json|xml))/i.test(contentType)) throw new Error('Invalid APK response')
      if (!(result.bytesWritten > 0) || (contentLength > 0 && result.bytesWritten != contentLength) ||
        (asset?.size > 0 && result.bytesWritten != asset.size)) throw new Error('Incomplete APK download')
      if (/^sha256:[a-f0-9]{64}$/i.test(asset?.digest ?? '')) {
        const actual = await hash(savePath, 'sha256')
        if (actual.toLowerCase() != asset.digest.slice(7).toLowerCase()) throw new Error('APK checksum mismatch')
      }
      apkSavePath = savePath
      return
    } catch (error) {
      lastError = error
      await removeMusicDownloadTarget(savePath).catch(() => {})
    }
  }
  throw lastError ?? new Error('Update download failed')
}

export const downloadNewVersion = (version, onDownload = noop) => {
  // Reopening the modal must not start two writers for the same APK.
  if (!downloadTask) {
    downloadTask = runDownload(version, onDownload).finally(() => { downloadTask = null })
  }
  return downloadTask
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
