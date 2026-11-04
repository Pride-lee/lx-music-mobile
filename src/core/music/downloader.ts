import { Linking, Platform } from 'react-native'
import {
  getPicUrl,
  getLyricInfo,
} from './online'
import { buildMusicDownloadHeaders, resolveDownloadSelection, type DownloadSelection } from './downloadInfo'
import settingState from '@/store/setting/state'
import {
  downloadFile,
  ensureMusicDownloadDirectory,
  existsMusicDownloadTarget,
  removeMusicDownloadTarget,
  scanMusicDownloadFile,
  stopDownload,
  temporaryDirectoryPath,
} from '@/utils/fs'
import { createDownloadFileName } from '@/utils/download'
import { sizeFormate } from '@/utils'
import { confirmDialog, requestStoragePermission, toast } from '@/utils/tools'
import { writeLyric, writePic, writeMetadata } from '@/utils/localMediaMetadata'
import { buildLyrics } from '@/utils/lrcTools'

const AUDIO_EXT_RXP = /\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/

type DownloadTaskStatus = 'waiting' | 'run' | 'error' | 'completed'

export interface DownloadTaskItem {
  id: string
  musicInfo: LX.Music.MusicInfoOnline
  filePath: string
  fileName: string
  quality: LX.Quality
  ext: string
  status: DownloadTaskStatus
  statusText: string
  progress: number
  downloaded: number
  total: number
  speed: string
  errorMessage: string
}

interface DownloadTaskState extends DownloadTaskItem {
  jobId: number | null
}

const downloadingTasks = new Map<string, Promise<string>>()
const downloadTaskStates = new Map<string, DownloadTaskState>()
const reservedPaths = new Set<string>()

const getDownloadTaskKey = (musicInfo: LX.Music.MusicInfoOnline) => `${musicInfo.source}:${musicInfo.id}`
const notifyDownloadListUpdate = () => {
  global.app_event.downloadListUpdate()
}

const createTaskState = (musicInfo: LX.Music.MusicInfoOnline): DownloadTaskState => ({
  id: getDownloadTaskKey(musicInfo),
  musicInfo,
  filePath: '',
  fileName: '',
  quality: '128k',
  ext: 'mp3',
  status: 'waiting',
  statusText: global.i18n.t('download_start', { name: musicInfo.name }),
  progress: 0,
  downloaded: 0,
  total: 0,
  speed: '',
  errorMessage: '',
  jobId: null,
})

const updateTaskState = (taskId: string, state: Partial<DownloadTaskState>) => {
  const prev = downloadTaskStates.get(taskId)
  if (!prev) return
  downloadTaskStates.set(taskId, { ...prev, ...state })
  notifyDownloadListUpdate()
}

export const getDownloadTasks = (): DownloadTaskItem[] => {
  return Array.from(downloadTaskStates.values()).map(({ jobId, ...item }) => ({ ...item }))
}

export const isMusicDownloading = (musicInfo: LX.Music.MusicInfoOnline) => {
  return downloadingTasks.has(getDownloadTaskKey(musicInfo))
}

export const removeDownloadTask = async(taskId: string, removeFile = false) => {
  const task = downloadTaskStates.get(taskId)
  if (!task) return
  downloadTaskStates.delete(taskId)
  if (task.jobId !== null && task.status !== 'completed') {
    stopDownload(task.jobId)
  }
  if (removeFile && task.filePath) {
    await removeMusicDownloadTarget(task.filePath).catch(() => {})
  }
  notifyDownloadListUpdate()
}

const parsePicExtByUrl = (url: string) => {
  const ext = url.match(AUDIO_EXT_RXP)?.[1]?.toLowerCase()
  return ext && ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg'
}

const writeDownloadPic = async(filePath: string, musicInfo: LX.Music.MusicInfoOnline, settings: LX.AppSetting) => {
  if (!settings['download.isEmbedPic']) return

  const picUrl = await getPicUrl({
    musicInfo,
    isRefresh: false,
    allowToggleSource: true,
  })
  if (!picUrl) return

  const picExt = parsePicExtByUrl(picUrl)
  const picPath = `${temporaryDirectoryPath}/download-pic-${Date.now()}-${Math.random().toString(36).slice(2)}.${picExt}`.replace(/\/+/g, '/')
  try {
    const result = await downloadFile(picUrl, picPath).promise
    if (result.statusCode >= 200 && result.statusCode < 300) {
      await writePic(filePath, picPath)
    } else throw new Error(`artwork download failed: ${result.statusCode}`)
  } finally {
    await removeMusicDownloadTarget(picPath).catch(() => {})
  }
}

const writeDownloadLyric = async(filePath: string, musicInfo: LX.Music.MusicInfoOnline, settings: LX.AppSetting) => {
  if (!settings['download.isEmbedLyric']) return

  const lyricInfo = await getLyricInfo({
    musicInfo,
    isRefresh: false,
    allowToggleSource: true,
  })
  const rawlrcInfo = lyricInfo.rawlrcInfo ?? lyricInfo
  if (!rawlrcInfo.lyric) return

  const lyric = buildLyrics(
    rawlrcInfo,
    settings['download.isEmbedLyricAwlrc'],
    settings['download.isEmbedLyricTranslation'],
    settings['download.isEmbedLyricRoma'],
  )
  if (lyric) await writeLyric(filePath, lyric)
}

const writeDownloadMetadata = async(filePath: string, musicInfo: LX.Music.MusicInfoOnline, settings: LX.AppSetting) => {
  const warnings: string[] = []
  if (!settings['download.writeMetadata'] && !settings['download.isEmbedPic'] && !settings['download.isEmbedLyric']) return warnings

  updateTaskState(getDownloadTaskKey(musicInfo), {
    statusText: global.i18n.t('download_write_metadata'),
  })

  if (settings['download.writeMetadata']) {
    await writeMetadata(filePath, {
      name: musicInfo.name,
      singer: musicInfo.singer,
      albumName: musicInfo.meta.albumName,
    }).catch((err: unknown) => {
      console.warn('write download tags failed', err)
      warnings.push(global.i18n.t('download_tags_failed'))
    })
  }
  await writeDownloadPic(filePath, musicInfo, settings).catch(err => {
    console.warn('write download pic failed', err)
    warnings.push(global.i18n.t('download_artwork_failed'))
  })
  await writeDownloadLyric(filePath, musicInfo, settings).catch(err => {
    console.warn('write download lyric failed', err)
    warnings.push(global.i18n.t('download_lyrics_failed'))
  })
  return warnings
}

const ensureAndroidStorageForPublicDownload = async() => {
  if (Platform.OS !== 'android') return

  const result = await requestStoragePermission()
  if (result === true) return

  if (result === false) {
    toast(global.i18n.t('download_permission_denied'), 'long')
    throw new Error(global.i18n.t('download_permission_denied'))
  }

  const openSettings = await confirmDialog({
    title: global.i18n.t('download_permission_blocked_title'),
    message: global.i18n.t('download_permission_blocked_message'),
    confirmButtonText: global.i18n.t('download_go_settings'),
    cancelButtonText: global.i18n.t('dialog_cancel'),
  })
  if (openSettings) {
    await Linking.openSettings()
  }
  throw new Error(global.i18n.t('download_permission_blocked_message'))
}

const runDownloadMusicToLocal = async(musicInfo: LX.Music.MusicInfoOnline, selection: DownloadSelection, settings: LX.AppSetting) => {
  await ensureAndroidStorageForPublicDownload()

  const taskId = getDownloadTaskKey(musicInfo)
  const assertActive = () => {
    if (!downloadTaskStates.has(taskId)) throw new Error(global.i18n.t('download_cancelled'))
  }
  assertActive()
  if (selection.musicId !== musicInfo.id || selection.source !== musicInfo.source) throw new Error(global.i18n.t('download_failed'))
  if (!global.lx.qualityList[musicInfo.source]?.includes(selection.quality)) throw new Error(global.i18n.t('download_quality_unsupported'))
  const downloadDir = await ensureMusicDownloadDirectory(settings['download.savePath'])
  const { quality, url, ext } = Date.now() - selection.resolvedAt > 60_000
    ? await resolveDownloadSelection(musicInfo, selection.quality)
    : selection
  assertActive()
  const baseName = createDownloadFileName(settings['download.fileName'], musicInfo, quality)
  let index = 0
  let savePath = ''
  while (true) {
    const suffix = index === 0 ? '' : ` (${index})`
    savePath = `${downloadDir}/${baseName}${suffix}.${ext}`.replace(/\/+/g, '/')
    if (!reservedPaths.has(savePath)) {
      reservedPaths.add(savePath)
      try {
        if (!(await existsMusicDownloadTarget(savePath))) break
      } catch (err) {
        reservedPaths.delete(savePath)
        throw err
      }
      reservedPaths.delete(savePath)
    }
    index++
  }

  try {
    assertActive()
    updateTaskState(taskId, {
      filePath: savePath,
      fileName: savePath.split(/\/|\\/).at(-1) ?? '',
      quality,
      ext,
      status: 'waiting',
      statusText: global.i18n.t('download_start', { name: musicInfo.name }),
    })

    let lastProgressTime = Date.now()
    let lastWritten = 0
    let invalidResponse = false

    const job = downloadFile(url, savePath, {
      background: true,
      headers: buildMusicDownloadHeaders(musicInfo),
      progressInterval: 500,
      begin: ({ jobId, contentLength, headers }) => {
        const contentType = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? ''
        if (/^(?:text\/|application\/(?:json|xml))/i.test(String(contentType))) {
          stopDownload(jobId)
          invalidResponse = true
        }
        updateTaskState(taskId, {
          jobId,
          status: 'run',
          total: contentLength,
          statusText: global.i18n.t('download_start', { name: musicInfo.name }),
        })
      },
      progress: ({ bytesWritten, contentLength }) => {
        const now = Date.now()
        const timeDiff = Math.max(now - lastProgressTime, 1)
        const byteDiff = Math.max(bytesWritten - lastWritten, 0)
        lastProgressTime = now
        lastWritten = bytesWritten
        const speed = byteDiff > 0 ? `${sizeFormate(byteDiff * 1000 / timeDiff)}/s` : ''
        updateTaskState(taskId, {
          status: 'run',
          downloaded: bytesWritten,
          total: contentLength,
          progress: contentLength > 0 ? bytesWritten / contentLength : 0,
          speed,
          statusText: speed ? `下载中 ${speed}` : '下载中',
        })
      },
    })
    updateTaskState(taskId, { jobId: job.jobId })
    const result = await job.promise
    assertActive()
    if (invalidResponse || result.bytesWritten === 0) throw new Error(global.i18n.t('download_failed'))
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`download failed: ${result.statusCode}`)
    }

    const warnings = await writeDownloadMetadata(savePath, musicInfo, settings)
    assertActive()

    if (Platform.OS === 'android') {
      await scanMusicDownloadFile(savePath)
    }
    assertActive()

    const message = [global.i18n.t('download_success', { path: savePath }), ...warnings].join('\n')
    updateTaskState(taskId, {
      status: 'completed',
      statusText: message,
      progress: 1,
      downloaded: result.bytesWritten ?? downloadTaskStates.get(taskId)?.downloaded ?? 0,
      total: result.bytesWritten ?? downloadTaskStates.get(taskId)?.total ?? 0,
      speed: '',
      errorMessage: warnings.join('\n'),
      jobId: null,
    })

    toast(message, warnings.length ? 'long' : 'short')
    return savePath
  } catch (err) {
    await removeMusicDownloadTarget(savePath).catch(() => {})
    throw err
  } finally {
    reservedPaths.delete(savePath)
  }
}

export const downloadMusicToLocal = async(musicInfo: LX.Music.MusicInfoOnline, selection: DownloadSelection) => {
  const taskKey = getDownloadTaskKey(musicInfo)
  const downloadingTask = downloadingTasks.get(taskKey)
  if (downloadingTask) return downloadingTask

  downloadTaskStates.set(taskKey, { ...createTaskState(musicInfo), quality: selection.quality })
  notifyDownloadListUpdate()
  toast(global.i18n.t('download_start', { name: musicInfo.name }))

  const task = runDownloadMusicToLocal(musicInfo, selection, { ...settingState.setting })
    .catch((err: any) => {
      updateTaskState(taskKey, {
        status: 'error',
        statusText: err?.message || global.i18n.t('download_failed'),
        errorMessage: err?.message || global.i18n.t('download_failed'),
        speed: '',
        jobId: null,
      })
      throw err
    })
    .finally(() => {
      downloadingTasks.delete(taskKey)
    })
  downloadingTasks.set(taskKey, task)
  return task
}
