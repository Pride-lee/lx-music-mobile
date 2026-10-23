import { checkUrl, httpGet } from '@/utils/request'
import { name } from '../../package.json'
import { downloadFile, stopDownload, temporaryDirectoryPath } from '@/utils/fs'
import { APP_PACKAGE_NAME, getSupportedAbis, installApk } from '@/utils/nativeModules/utils'
import { APP_PROVIDER_NAME } from '@/config/constant'
import releaseChannels from '../../release-channels.json'

// fork：检查更新只看自己的仓库；GitHub 仓库 slug 仍保持 package.json 的 name（lx-music-mobile）
const FORK_OWNER = 'Pride-lee'
const FORK_REPO = name

const getUpdateChannel = () => {
  const channel = Object.values(releaseChannels).find(channel => channel.applicationId == APP_PACKAGE_NAME)
  if (!channel) throw new Error(`Unsupported update package: ${APP_PACKAGE_NAME}`)
  return channel
}

const getApkDownloadUrl = (version, abi, releaseSuffix) => {
  return `https://github.com/${FORK_OWNER}/${FORK_REPO}/releases/download/v${version}${releaseSuffix}/${FORK_REPO}-v${version}-${abi}${releaseSuffix}.apk`
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
      release = await request(`https://api.github.com/repos/${FORK_OWNER}/${FORK_REPO}/releases/tags/${encodeURIComponent(tag)}`)
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
let downloadJobId = null
const noop = (total, download) => {}
let apkSavePath

export const downloadNewVersion = async(version, onDownload = noop) => {
  const { releaseSuffix } = getUpdateChannel()
  const abi = await getTargetAbi()
  const url = getApkDownloadUrl(version, abi, releaseSuffix)
  let savePath = `${temporaryDirectoryPath}/${APP_PACKAGE_NAME}-update.apk`

  if (downloadJobId) stopDownload(downloadJobId)

  const { jobId, promise } = downloadFile(url, savePath, {
    progressInterval: 500,
    connectionTimeout: 20000,
    readTimeout: 30000,
    begin({ statusCode, contentLength }) {
      onDownload(contentLength, 0)
      // switch (statusCode) {
      //   case 200:
      //   case 206:
      //     break
      //   default:
      //     onDownload(null, contentLength, 0)
      //     break
      // }
    },
    progress({ contentLength, bytesWritten }) {
      onDownload(contentLength, bytesWritten)
    },
  })
  downloadJobId = jobId
  return promise.then(() => {
    apkSavePath = savePath
    return updateApp()
  })
}

export const updateApp = async() => {
  if (!apkSavePath) throw new Error('apk Save Path is null')
  await installApk(apkSavePath, APP_PROVIDER_NAME)
}
