const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')

const root = path.join(__dirname, '..')
function load(file, mocks = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) { assert.ok(name in mocks, `Unexpected import: ${name}`); return mocks[name] },
    console: { log() {}, warn() {}, error() {} },
    AbortController, setTimeout, clearTimeout, ...globals,
  }, { filename: file })
  return exports
}
const utils = load('src/utils/download.ts')
const song = (id = '1') => ({
  id, name: 'Song', singer: 'Artist', source: 'kw', interval: '03:00',
  meta: { songId: id, albumName: 'Album', qualitys: [], _qualitys: { '320k': { size: '8 MB' } } },
})
const selection = (info = song(), quality = '320k') => ({
  quality, url: 'https://example.test/audio.mp3', ext: 'mp3', size: 100,
  resolvedAt: Date.now(), musicId: info.id, source: info.source,
})
const tick = () => new Promise(resolve => setImmediate(resolve))
const i18n = { t: key => key }

test('seven tiers, legacy Hi-Res and provider capability checks', () => {
  const rows = utils.getDownloadQualities(song(), ['128k', '320k', 'flac24bit'])
  assert.equal(rows.length, 7)
  assert.equal(rows.filter(row => row.supported).length, 3)
  assert.equal(rows[1].size, '8 MB')
  assert.equal(rows[3].quality, 'flac24bit')
  assert.equal(rows[6].supported, false)
  const extended = utils.getDownloadQualities(song(), ['hires', 'atmos', 'atmos_plus', 'master'])
  assert.equal(extended[3].quality, 'hires')
  assert.equal(extended[3].supported, true)
  assert.equal(extended[6].supported, true)
  assert.equal(utils.getDownloadQualities(song()).filter(row => row.supported).length, 0)
})

test('filename templates support all tokens, repeats and legacy presets', () => {
  assert.equal(utils.createDownloadFileName('歌名 - 歌手', song(), 'flac'), 'Song - Artist')
  assert.equal(utils.createDownloadFileName('{name}-{name}-{singer}-{album}-{source}-{id}-{quality}', song(), 'flac'),
    'Song-Song-Artist-Album-kw-1-flac')
  assert.equal(utils.formatDownloadName('歌名 歌名 歌手 专辑 音源 歌曲ID 音质', song(), '320k'),
    'Song Song Artist Album kw 1 320k')
  assert.equal(utils.formatDownloadName('歌名 - 歌手', { ...song(), name: '歌手 {album}' }), '歌手 {album} - Artist')
})

test('invalid templates are rejected and filenames stay safe and bounded', () => {
  for (const value of ['', 'artist only', '../{name}', '{name}/{singer}', '{name}:{id}', '{name}{unknown}', '{name}\0', '{name}.mp3']) {
    assert.equal(utils.isValidDownloadTemplate(value), false, value)
  }
  assert.equal(utils.isValidDownloadTemplate('{singer} - {name} [{quality}]'), true)
  assert.equal(utils.isValidDownloadTemplate('歌名 - 歌手'), true)
  const unsafe = { ...song(), name: '../CON', singer: 'A/B:*?"<C>|' }
  const name = utils.createDownloadFileName('{name} - {singer}', unsafe, 'flac')
  assert.ok(!/[\\/<>:"|?*\x00-\x1f]/.test(name))
  assert.ok(!name.startsWith('.'))
  assert.equal(utils.createDownloadFileName('{name}', { ...song(), name: 'CON' }, ''), '_CON')
  assert.equal(utils.createDownloadFileName('{name}', { ...song(), name: '...' }, ''), 'music')
  const long = utils.createDownloadFileName('{name}', { ...song(), name: '音'.repeat(500) }, '')
  assert.ok(Buffer.byteLength(long) <= 180)
})

test('audio extensions use MIME, whitelist URL extensions and sensible quality fallback', () => {
  assert.equal(utils.getDownloadExtension('https://example.test/api.php?name=a.mp3', 'flac24bit'), 'flac')
  assert.equal(utils.getDownloadExtension('https://example.test/x.mp3', 'flac', 'audio/flac; charset=binary'), 'flac')
  assert.equal(utils.getDownloadExtension('https://example.test/x.M4A?token=1', 'atmos'), 'm4a')
  assert.equal(utils.getDownloadExtension('https://example.test/noext', '128k'), 'mp3')
  assert.equal(utils.getDownloadExtension('https://example.test/noext', 'master'), 'flac')
})

test('sizes reject invalid values and prefer total length over range size', () => {
  const headers = values => ({ get: name => values[name] ?? null })
  assert.equal(utils.getDownloadContentLength(headers({ 'content-length': '1048576' })), 1048576)
  assert.equal(utils.getDownloadContentLength(headers({ 'content-length': '1', 'content-range': 'bytes 0-0/9999' })), 9999)
  for (const value of ['0', '-1', 'bad', '1.5', 'Infinity']) {
    assert.equal(utils.getDownloadContentLength(headers({ 'content-length': value })), null)
  }
})

function resolverSetup(options = {}) {
  const requests = []
  const apiCalls = []
  const api = load('src/core/music/downloadInfo.ts', {
    './utils': { async handleGetOnlineMusicUrl(args) {
      apiCalls.push(args)
      return { quality: options.returnedQuality ?? args.quality, url: options.url ?? 'https://example.test/download' }
    } },
    '@/utils/download': utils,
  }, {
    global: { lx: { qualityList: { kw: ['128k', '320k', 'flac', 'master'] } }, i18n },
    fetch: async(url, args) => {
      requests.push({ url, args })
      if (options.fetchError) throw new Error('HEAD unsupported')
      return { ok: options.ok !== false, headers: { get: name => options.headers?.[name] ?? null } }
    },
  })
  return { ...api, requests, apiCalls }
}

test('resolves exact quality without fallback and uses only HEAD for size', async() => {
  const setup = resolverSetup({ headers: { 'content-type': 'audio/flac', 'content-length': '12345' } })
  const result = await setup.resolveDownloadSelection(song(), 'flac')
  assert.equal(result.size, 12345)
  assert.equal(result.ext, 'flac')
  assert.equal(result.quality, 'flac')
  assert.equal(setup.apiCalls[0].allowToggleSource, false)
  assert.equal(setup.apiCalls[0].isRefresh, true)
  assert.equal(setup.requests[0].args.method, 'HEAD')
  assert.equal(setup.requests[0].args.headers.Referer, 'https://www.kuwo.cn/')
})

test('unknown size and rejected HEAD do not prevent downloading', async() => {
  for (const options of [{ fetchError: true }, { ok: false }, {}]) {
    const result = await resolverSetup(options).resolveDownloadSelection(song(), '320k')
    assert.equal(result.size, null)
    assert.equal(result.ext, 'mp3')
  }
})

test('unsupported tiers, downgraded responses and non-audio responses are rejected', async() => {
  const unsupported = resolverSetup()
  await assert.rejects(unsupported.resolveDownloadSelection(song(), 'atmos'), /unsupported/)
  assert.equal(unsupported.apiCalls.length, 0)
  await assert.rejects(resolverSetup({ returnedQuality: '128k' }).resolveDownloadSelection(song(), 'flac'), /mismatch/)
  await assert.rejects(resolverSetup({ url: 'file:///audio.mp3' }).resolveDownloadSelection(song(), '320k'), /failed/)
  await assert.rejects(resolverSetup({ headers: { 'content-type': 'text/html' } }).resolveDownloadSelection(song(), '320k'), /failed/)
})

test('closing the dialog prevents stale requests from producing a selection', async() => {
  const setup = resolverSetup()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(setup.resolveDownloadSelection(song(), '320k', controller.signal), /cancelled/)
  assert.equal(setup.requests.length, 0)
  assert.equal(setup.apiCalls.length, 0)
})

function downloaderSetup(options = {}) {
  const files = new Set(options.existing ?? [])
  const downloads = []
  const tags = []
  const stopped = []
  const notices = []
  const refreshed = []
  const settings = {
    'download.fileName': '歌名 - 歌手', 'download.quality': '128k', 'download.savePath': '/downloads',
    'download.writeMetadata': true, 'download.isEmbedPic': false, 'download.isEmbedLyric': false,
    ...options.settings,
  }
  const jobs = new Map()
  const api = load('src/core/music/downloader.ts', {
    'react-native': { Platform: { OS: 'android' }, Linking: { async openSettings() {} } },
    './downloadInfo': {
      buildMusicDownloadHeaders: () => ({}),
      async resolveDownloadSelection(info, quality) { refreshed.push(quality); return selection(info, quality) },
    },
    './online': { async getPicUrl() { return null }, async getLyricInfo() { return { lyric: '[00:00]Lyric' } } },
    '@/store/setting/state': { setting: settings },
    '@/utils/fs': {
      async ensureMusicDownloadDirectory(savePath) { return savePath },
      async existsMusicDownloadTarget(file) { return files.has(file) },
      async removeMusicDownloadTarget(file) { files.delete(file) },
      async scanMusicDownloadFile() {},
      temporaryDirectoryPath: '/temp',
      stopDownload(id) { stopped.push(id); jobs.get(id)?.reject(new Error('cancelled')) },
      downloadFile(url, file, args = {}) {
        const jobId = downloads.length
        files.add(file)
        downloads.push({ url, file, args })
        let resolve, reject
        const promise = new Promise((res, rej) => { resolve = res; reject = rej })
        jobs.set(jobId, { resolve, reject })
        if (!options.pending) {
          queueMicrotask(() => {
            args.begin?.({ jobId, contentLength: 100, headers: options.headers ?? {} })
            args.progress?.({ bytesWritten: 100, contentLength: 100 })
            resolve({ statusCode: options.statusCode ?? 200, bytesWritten: options.bytesWritten ?? 100 })
          })
        }
        return { jobId, promise }
      },
    },
    '@/utils/download': utils,
    '@/utils': { sizeFormate: n => `${n} B` },
    '@/utils/tools': {
      async requestStoragePermission() { return options.permission ?? true },
      async confirmDialog() { return false },
      toast(text) { notices.push(text) },
    },
    '@/utils/localMediaMetadata': {
      async writeMetadata(file, data) { tags.push({ file, data }); if (options.tagFailure) throw new Error('unsupported format') },
      async writePic() {},
      async writeLyric() { if (options.lyricFailure) throw new Error('lyric write failed') },
    },
    '@/utils/lrcTools': { buildLyrics: info => info.lyric },
  }, {
    global: { lx: { qualityList: { kw: ['128k', '320k', 'flac', 'master'] } }, i18n, app_event: { downloadListUpdate() {} } },
  })
  return { ...api, files, downloads, settings, tags, stopped, notices, refreshed, jobs }
}

test('selected quality reaches the download and real metadata writer', async() => {
  const setup = downloaderSetup()
  const result = await setup.downloadMusicToLocal(song(), selection(song(), 'flac'))
  assert.equal(result, '/downloads/Song - Artist.mp3')
  assert.equal(setup.getDownloadTasks()[0].quality, 'flac')
  assert.equal(setup.getDownloadTasks()[0].status, 'completed')
  assert.deepEqual({ ...setup.tags[0].data }, { name: 'Song', singer: 'Artist', albumName: 'Album' })
  assert.ok(setup.files.has(result))
})

test('settings are snapshotted when confirming and metadata switch is respected', async() => {
  const setup = downloaderSetup({ settings: { 'download.writeMetadata': false, 'download.fileName': '{name}-{quality}' } })
  const pending = setup.downloadMusicToLocal(song(), selection())
  setup.settings['download.fileName'] = 'changed'
  setup.settings['download.writeMetadata'] = true
  setup.settings['download.savePath'] = '/other'
  const result = await pending
  assert.equal(result, '/downloads/Song-320k.mp3')
  assert.equal(setup.tags.length, 0)
})

test('concurrent same-name songs and existing files never overwrite one another', async() => {
  const setup = downloaderSetup({ existing: ['/downloads/Song - Artist.mp3'] })
  const first = song('1')
  const second = song('2')
  const results = await Promise.all([
    setup.downloadMusicToLocal(first, selection(first)),
    setup.downloadMusicToLocal(second, selection(second)),
  ])
  assert.equal(new Set(results).size, 2)
  assert.ok(results.includes('/downloads/Song - Artist (1).mp3'))
  assert.ok(results.includes('/downloads/Song - Artist (2).mp3'))
  assert.equal(setup.files.size, 3)
})

test('double confirmation deduplicates and expired URLs refresh the same quality', async() => {
  const setup = downloaderSetup()
  const selected = { ...selection(), resolvedAt: 1 }
  await Promise.all([setup.downloadMusicToLocal(song(), selected), setup.downloadMusicToLocal(song(), selected)])
  assert.equal(setup.downloads.length, 1)
  assert.deepEqual(setup.refreshed, ['320k'])
})

test('metadata failure keeps audio and appears in completion status', async() => {
  const setup = downloaderSetup({ tagFailure: true, lyricFailure: true, settings: { 'download.isEmbedLyric': true } })
  const result = await setup.downloadMusicToLocal(song(), selection())
  assert.ok(setup.files.has(result))
  const task = setup.getDownloadTasks()[0]
  assert.equal(task.status, 'completed')
  assert.match(task.statusText, /download_tags_failed/)
  assert.match(task.statusText, /download_lyrics_failed/)
  assert.match(setup.notices.at(-1), /download_tags_failed/)
})

test('HTTP errors, empty files and HTML responses remove partial downloads', async() => {
  for (const options of [{ statusCode: 403 }, { bytesWritten: 0 }, { headers: { 'Content-Type': 'text/html' } }]) {
    const setup = downloaderSetup(options)
    await assert.rejects(setup.downloadMusicToLocal(song(), selection()))
    assert.equal(setup.files.size, 0)
    assert.equal(setup.getDownloadTasks()[0].status, 'error')
    assert.equal(setup.isMusicDownloading(song()), false)
    assert.equal(setup.tags.length, 0)
  }
})

test('removing an active download stops even job zero and cleans partial audio', async() => {
  const setup = downloaderSetup({ pending: true })
  const task = setup.downloadMusicToLocal(song(), selection())
  const rejection = assert.rejects(task, /cancelled/)
  await tick()
  await setup.removeDownloadTask('kw:1', true)
  await rejection
  assert.deepEqual(setup.stopped, [0])
  assert.equal(setup.files.size, 0)
  assert.equal(setup.getDownloadTasks().length, 0)
})

test('removing a waiting download cannot start it later', async() => {
  const setup = downloaderSetup()
  const task = setup.downloadMusicToLocal(song(), selection())
  await setup.removeDownloadTask('kw:1')
  await assert.rejects(task, /cancelled/)
  assert.equal(setup.downloads.length, 0)
})

test('permission denial and mismatched song selections never start a transfer', async() => {
  const denied = downloaderSetup({ permission: false })
  await assert.rejects(denied.downloadMusicToLocal(song(), selection()), /permission/)
  assert.equal(denied.downloads.length, 0)
  const wrong = downloaderSetup()
  await assert.rejects(wrong.downloadMusicToLocal(song(), selection(song('2'))), /failed/)
  assert.equal(wrong.downloads.length, 0)
})

test('both list entry points use the shared mandatory quality dialog', () => {
  for (const file of ['src/components/OnlineList/index.tsx', 'src/screens/Home/Views/Mylist/MusicList/index.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /onDownload=\{info => \{ downloadModalRef\.current\?\.show\(info\.musicInfo\)/)
    assert.match(source, /<MusicDownloadModal/)
  }
  const source = fs.readFileSync(path.join(root, 'src/components/MusicDownloadModal.tsx'), 'utf8')
  assert.match(source, /check=\{quality === item\.quality\}/)
  assert.match(source, /disabled=\{!item\.supported\}/)
  assert.match(source, /controller\.abort\(\)/)
})

test('all new labels exist in every locale and native scripts allow all seven tiers', () => {
  const locales = ['zh-cn', 'zh-tw', 'en-us'].map(locale => JSON.parse(fs.readFileSync(path.join(root, `src/lang/${locale}.json`))))
  for (const key of Object.keys(locales[0]).filter(key => key.startsWith('download_'))) {
    for (const locale of locales) assert.ok(locale[key], key)
  }
  const script = fs.readFileSync(path.join(root, 'android/app/src/main/assets/script/user-api-preload.js'), 'utf8')
  const object = script.match(/const supportQualitys = (\{[\s\S]*?\n  \})/)[1]
  const supported = vm.runInNewContext(`(${object})`)
  for (const source of ['kw', 'kg', 'tx', 'wy', 'mg']) {
    for (const quality of utils.DOWNLOAD_QUALITIES) assert.ok(supported[source].includes(quality.id))
    assert.ok(supported[source].includes('hires'))
  }
})
