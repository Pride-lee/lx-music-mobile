export const DOWNLOAD_QUALITIES = [
  { id: '128k', label: 'download_quality_standard' },
  { id: '320k', label: 'download_quality_high' },
  { id: 'flac', label: 'download_quality_lossless' },
  { id: 'flac24bit', label: 'download_quality_hires' },
  { id: 'atmos', label: 'download_quality_atmos' },
  { id: 'atmos_plus', label: 'download_quality_atmos_plus' },
  { id: 'master', label: 'download_quality_master' },
] as const

export const getDownloadQualities = (musicInfo: LX.Music.MusicInfoOnline, supported: readonly LX.Quality[] = []) => {
  return DOWNLOAD_QUALITIES.map(item => {
    const quality: LX.Quality = item.id === 'flac24bit' && !supported.includes('flac24bit') && supported.includes('hires')
      ? 'hires'
      : item.id
    const metadata = musicInfo.meta._qualitys[quality] ?? (item.id === 'flac24bit' ? musicInfo.meta._qualitys.hires ?? musicInfo.meta._qualitys.flac24bit : undefined)
    return { ...item, quality, supported: supported.includes(quality), size: metadata?.size ?? null }
  })
}

export const FILE_NAME_PRESETS = ['歌名 - 歌手', '歌手 - 歌名', '歌名'] as const
const TOKEN_PATTERN = /\{(name|singer|album|source|id|quality)\}|歌曲ID|歌名|歌手|专辑|音源|音质/g
// Control characters and path separators must never reach a filesystem basename.
// eslint-disable-next-line no-control-regex
const INVALID_FILE_CHARACTERS = /[\\/:*?#"<>|\x00-\x1f]/g

export const formatDownloadName = (template: string, musicInfo: LX.Music.MusicInfo, quality = '') => {
  const values: Record<string, string> = {
    name: musicInfo.name,
    singer: musicInfo.singer || '未知歌手',
    album: musicInfo.meta.albumName || '未知专辑',
    source: musicInfo.source,
    id: String(musicInfo.meta.songId),
    quality,
  }
  const aliases: Record<string, string> = { 歌名: 'name', 歌手: 'singer', 专辑: 'album', 音源: 'source', 歌曲ID: 'id', 音质: 'quality' }
  return template.replace(TOKEN_PATTERN, (token: string, key?: string) => values[key ?? aliases[token]]).trim()
}

export const isValidDownloadTemplate = (template: string) => {
  return template.trim().length > 0 && template.length <= 160 &&
    /歌名|\{name\}/.test(template) &&
    !template.match(INVALID_FILE_CHARACTERS) &&
    !/\.(mp3|flac|m4a|aac|ogg|wav|ape)$/i.test(template.trim()) &&
    !/[{}]/.test(template.replace(/\{(?:name|singer|album|source|id|quality)\}/g, ''))
}

export const createDownloadFileName = (template: string, musicInfo: LX.Music.MusicInfo, quality: string) => {
  const name = formatDownloadName(template, musicInfo, quality)
    .replace(INVALID_FILE_CHARACTERS, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  // Stay below common 255-byte filesystem limits, including duplicate suffixes.
  let result = ''
  let bytes = 0
  for (const char of name) {
    const code = char.codePointAt(0)!
    const length = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes + length > 180) break
    bytes += length
    result += char
  }
  if (!result) result = 'music'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`
  return result.replace(/[.\s]+$/g, '')
}

export const getDownloadExtension = (url: string, quality: LX.Quality, contentType = '') => {
  const type = contentType.toLowerCase().split(';')[0].trim()
  const formats: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'application/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ape': 'ape',
    'audio/x-ape': 'ape',
  }
  if (formats[type]) return formats[type]
  const ext = url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (ext && ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'ape'].includes(ext)) return ext
  return ['128k', '192k', '320k'].includes(quality) ? 'mp3' : 'flac'
}

export const getDownloadContentLength = (headers: { get: (name: string) => string | null }) => {
  const range = headers.get('content-range')?.match(/\/(\d+)$/)?.[1]
  const size = Number(range ?? headers.get('content-length'))
  return Number.isSafeInteger(size) && size > 0 ? size : null
}
