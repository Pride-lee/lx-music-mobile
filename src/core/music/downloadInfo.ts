import { handleGetOnlineMusicUrl } from './utils'
import { getDownloadContentLength, getDownloadExtension } from '@/utils/download'

export interface DownloadSelection {
  quality: LX.Quality
  url: string
  ext: string
  size: number | null
  resolvedAt: number
  musicId: string
  source: LX.OnlineSource
}

export const buildMusicDownloadHeaders = (musicInfo: LX.Music.MusicInfoOnline): Record<string, string> => {
  const referers: Record<LX.OnlineSource, string> = {
    wy: 'https://music.163.com/',
    kg: 'https://www.kugou.com/',
    kw: 'https://www.kuwo.cn/',
    tx: 'https://y.qq.com/portal/player.html',
    mg: 'https://music.migu.cn/v3',
  }
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
    Referer: referers[musicInfo.source],
  }
}

export const resolveDownloadSelection = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality, signal?: AbortSignal): Promise<DownloadSelection> => {
  if (signal?.aborted) throw new Error('cancelled')
  if (!global.lx.qualityList[musicInfo.source]?.includes(quality)) throw new Error(global.i18n.t('download_quality_unsupported'))
  // Downloads must keep the chosen source and quality, independent of playback fallback.
  let result: Awaited<ReturnType<typeof handleGetOnlineMusicUrl>>
  try {
    result = await handleGetOnlineMusicUrl({
      musicInfo, quality, isRefresh: true, allowToggleSource: false, onToggleSource: () => {},
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('cancelled')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(global.i18n.t('download_source_failed', { message }))
  }
  if (signal?.aborted) throw new Error('cancelled')
  if (result.quality !== quality) throw new Error(global.i18n.t('download_quality_mismatch'))
  if (!/^https?:\/\//i.test(result.url)) throw new Error(global.i18n.t('download_failed'))
  const controller = new AbortController()
  const cancel = () => { controller.abort() }
  signal?.addEventListener('abort', cancel)
  const timer = setTimeout(cancel, 5000)
  let size: number | null = null
  let contentType = ''
  try {
    const response = await fetch(result.url, {
      method: 'HEAD', headers: buildMusicDownloadHeaders(musicInfo), signal: controller.signal,
    })
    if (response.ok) {
      size = getDownloadContentLength(response.headers)
      contentType = response.headers.get('content-type') ?? ''
    }
  } catch {
    // Some providers reject HEAD; an unknown size must not block the download.
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
  if (signal?.aborted) throw new Error('cancelled')
  if (/^(?:text\/|application\/(?:json|xml))/i.test(contentType)) throw new Error(global.i18n.t('download_failed'))
  return {
    quality,
    url: result.url,
    size,
    ext: getDownloadExtension(result.url, quality, contentType),
    resolvedAt: Date.now(),
    musicId: musicInfo.id,
    source: musicInfo.source,
  }
}
