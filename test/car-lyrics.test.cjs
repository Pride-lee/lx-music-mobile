const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const settingKey = 'player.isShowCarwithLyric'
const lrc = '[00:00.00]First line\n[00:05.00]Second line'
const empty = { ucarLyricWhole: '', ucarLyricLine: '' }

function loadTs(file, mocks, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) {
      assert.ok(name in mocks, `Unexpected import: ${name}`)
      return mocks[name]
    },
    console,
    ...globals,
  }, { filename: file })
  return exports
}

function setup(enabled = false, options = {}) {
  const updates = []
  const warnings = []
  const timers = new Map()
  const appEvents = new EventEmitter()
  const stateEvents = new EventEmitter()
  const settings = { setting: { [settingKey]: enabled, 'player.isShowBluetoothFullLyric': false } }
  const player = {
    musicInfo: { id: 'song-a', lrc, name: 'Song', singer: 'Artist', album: 'Album' },
    isPlay: false,
  }
  let timerId = 0
  let playHook
  let rejectUpdates = false
  const trackPlayer = {
    async updateNowPlayingTitles(data) {
      updates.push({ ...data })
      if (rejectUpdates) throw new Error('Player not ready')
    },
  }
  const backgroundTimer = {
    setTimeout(fn, delay) {
      timers.set(++timerId, { fn, delay })
      return timerId
    },
    clearTimeout(id) { timers.delete(id) },
  }
  const lyricPlugin = {
    addLyricPlayHook(hook) { playHook = hook; hook(0, '') },
    setLyric() { playHook(-1, '') },
    init: async() => {},
    play() {},
    pause() {},
  }
  const globals = {
    global: { app_event: appEvents, state_event: stateEvents },
    console: { warn(...args) { warnings.push(args) } },
  }
  const api = loadTs('src/plugins/player/carLyric.ts', {
    'react-native-track-player': trackPlayer,
    'react-native-background-timer': backgroundTimer,
    '@/plugins/lyric': lyricPlugin,
    '@/store/player/state': player,
    '@/store/setting/state': settings,
  }, globals)
  api.initCarLyric()
  updates.length = 0

  const core = loadTs('src/core/lyric.ts', {
    '@/plugins/lyric': lyricPlugin,
    '@/core/desktopLyric': {
      async setDesktopLyric() { await options.setDesktopLyric?.() },
      async playDesktopLyric() {},
      async pauseDesktopLyric() {},
    },
    '@/plugins/player': { getPosition: async() => 0 },
    '@/store/player/state': player,
    '@/store/setting/state': settings,
    '@/plugins/player/utils': trackPlayer,
    '@/plugins/player/carLyric': api,
  }, globals)
  appEvents.on('stop', core.stop)
  appEvents.on('musicToggled', core.stop)
  return {
    api,
    core,
    player,
    settings,
    updates,
    warnings,
    timers,
    appEvents,
    stateEvents,
    trackPlayer,
    backgroundTimer,
    line(text) { playHook(1, text) },
    toggle(value) {
      settings.setting[settingKey] = value
      stateEvents.emit('configUpdated', [settingKey])
    },
    play() { player.isPlay = true; appEvents.emit('play') },
    flushTimers() {
      const pending = [...timers.values()]
      timers.clear()
      pending.forEach(({ fn }) => fn())
    },
    rejectUpdates() { rejectUpdates = true },
  }
}

test('car lyrics default to off and have labels in every supported locale', () => {
  const settings = loadTs('src/config/defaultSetting.ts', {}).default
  assert.equal(settings[settingKey], false)
  for (const locale of ['zh-cn', 'zh-tw', 'en-us']) {
    const messages = JSON.parse(fs.readFileSync(path.join(root, `src/lang/${locale}.json`), 'utf8'))
    assert.match(messages.setting_play_show_carwith_lyric, /CarWith.*Jovi InCar/)
  }
})

test('disabled car lyrics do not publish or schedule retries', () => {
  const h = setup()
  h.api.setCarLyric(lrc)
  h.line('First line')
  h.play()
  assert.deepEqual(h.updates, [])
  assert.equal(h.timers.size, 0)
  assert.deepEqual({ ...h.api.getCarLyricMetadata('song-a') }, empty)
  assert.equal(h.api.getFullLyric('song-a'), '')
})

test('enabling publishes cached whole lyrics and current line without changing song titles', () => {
  const h = setup()
  h.api.setCarLyric(lrc)
  h.line('First line')
  h.toggle(true)
  assert.deepEqual(h.updates, [{ ucarLyricWhole: lrc, ucarLyricLine: 'First line', lyric: lrc }])
})

test('lyric callbacks publish only the car lyric line', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.updates.length = 0
  h.line('Second line')
  assert.deepEqual(h.updates, [{ ucarLyricLine: 'Second line' }])
  h.line(null)
  assert.deepEqual(h.updates.at(-1), { ucarLyricLine: '' })
})

test('disabling clears both car fields, cancels retries, and preserves Bluetooth metadata', () => {
  const h = setup(true)
  h.settings.setting['player.isShowBluetoothFullLyric'] = true
  h.api.setCarLyric(lrc)
  h.play()
  h.toggle(false)
  assert.deepEqual(h.updates.at(-1), { ...empty, lyric: lrc })
  assert.equal(h.timers.size, 0)
  const count = h.updates.length
  h.line('Second line')
  h.flushTimers()
  assert.equal(h.updates.length, count)
  assert.ok(h.updates.every(data => !('title' in data)))
})

test('disabling car lyrics also clears shared LRC when full Bluetooth lyrics are off', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.toggle(false)
  assert.deepEqual(h.updates.at(-1), { ...empty, lyric: '' })
})

test('full Bluetooth lyrics still work with car lyrics disabled', async() => {
  const h = setup()
  h.settings.setting['player.isShowBluetoothFullLyric'] = true
  await h.core.setLyric()
  assert.deepEqual(h.updates[0], { ...empty, lyric: lrc })
  h.settings.setting['player.isShowBluetoothFullLyric'] = false
  h.stateEvents.emit('configUpdated', ['player.isShowBluetoothFullLyric'])
  assert.deepEqual(h.updates.at(-1), { ...empty, lyric: '' })
})

test('turning off full Bluetooth lyrics keeps the LRC needed by car lyrics', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.line('First line')
  h.stateEvents.emit('configUpdated', ['player.isShowBluetoothFullLyric'])
  assert.deepEqual(h.updates.at(-1), { ucarLyricWhole: lrc, ucarLyricLine: 'First line', lyric: lrc })
})

test('play sends a snapshot and resends the latest line after 1500 ms', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.play()
  assert.equal([...h.timers.values()][0].delay, 1500)
  h.line('Second line')
  h.flushTimers()
  assert.deepEqual(h.updates.at(-1), { ucarLyricWhole: lrc, ucarLyricLine: 'Second line', lyric: lrc })
})

test('repeated play events replace rather than accumulate delayed updates', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.play()
  h.play()
  assert.equal(h.timers.size, 1)
})

for (const event of ['pause', 'error', 'stop', 'musicToggled']) {
  test(`${event} cancels a pending resend`, () => {
    const h = setup(true)
    h.api.setCarLyric(lrc)
    h.play()
    h.appEvents.emit(event)
    assert.equal(h.timers.size, 0)
  })
}

test('switching songs clears old lyrics before the next song has loaded', async() => {
  const h = setup(true)
  await h.core.setLyric()
  h.line('First line')
  h.play()
  h.player.musicInfo = { id: 'song-b', lrc: null }
  h.appEvents.emit('musicToggled')
  assert.ok(h.updates.some(data => data.ucarLyricWhole === ''))
  assert.deepEqual({ ...h.api.getCarLyricMetadata('song-b') }, empty)
  h.flushTimers()
  await h.core.setLyric()
  assert.deepEqual({ ...h.api.getCarLyricMetadata('song-b') }, empty)
})

test('stop clears cached lyrics even if player musicInfo still contains the old LRC', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.line('First line')
  h.appEvents.emit('stop')
  assert.equal(h.player.musicInfo.lrc, lrc)
  assert.deepEqual({ ...h.api.getCarLyricMetadata('song-a') }, empty)
  assert.equal(h.api.getFullLyric('song-a'), '')
  h.play()
  h.flushTimers()
  assert.deepEqual(h.updates.at(-1), { ...empty, lyric: '' })
})

test('an already queued resend cannot publish the previous song', () => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.play()
  h.player.musicInfo = { id: 'song-b', lrc: null }
  const count = h.updates.length
  h.flushTimers()
  assert.equal(h.updates.length, count)
  assert.deepEqual({ ...h.api.getCarLyricMetadata('song-a') }, empty)
  assert.deepEqual({ ...h.api.getCarLyricMetadata('song-b') }, empty)
})

test('a delayed desktop lyric update cannot republish the previous song after switching', async() => {
  const pending = []
  const h = setup(true, {
    setDesktopLyric: () => new Promise(resolve => pending.push(resolve)),
  })
  const first = h.core.setLyric()
  h.player.musicInfo = { id: 'song-b', lrc: '[00:00.00]New song' }
  const second = h.core.setLyric()
  const count = h.updates.length
  pending[1]()
  await second
  pending[0]()
  await first
  assert.equal(h.updates.length, count)
  assert.equal(h.api.getFullLyric('song-b'), '[00:00.00]New song')
  assert.equal(h.api.getFullLyric('song-a'), '')
})

test('enabling while paused publishes immediately without starting a playback timer', () => {
  const h = setup()
  h.api.setCarLyric(lrc)
  h.toggle(true)
  assert.deepEqual(h.updates.at(-1), { ucarLyricWhole: lrc, ucarLyricLine: '', lyric: lrc })
  assert.equal(h.timers.size, 0)
})

test('unrelated settings do not resend lyrics and initialization is idempotent', () => {
  const h = setup(true)
  h.api.initCarLyric()
  assert.equal(h.appEvents.listenerCount('play'), 1)
  assert.equal(h.stateEvents.listenerCount('configUpdated'), 1)
  h.stateEvents.emit('configUpdated', ['player.volume'])
  assert.deepEqual(h.updates, [])
})

test('player-not-ready errors are caught for snapshots and line updates', async() => {
  const h = setup(true)
  h.rejectUpdates()
  h.api.setCarLyric(lrc)
  h.line('First line')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.warnings.length, 2)
})

test('playlist creation and metadata refresh carry car lyrics through cover/title updates', async() => {
  const h = setup(true)
  h.api.setCarLyric(lrc)
  h.line('First line')
  const queue = []
  const metadata = []
  Object.assign(h.trackPlayer, {
    State: { Playing: 'playing' },
    async add(tracks) { queue.push(...tracks) },
    async getQueue() { return queue },
    async skip() {},
    async getState() { return 'playing' },
    async updateNowPlayingMetadata(data) { metadata.push({ ...data }) },
  })
  const playlist = loadTs('src/plugins/player/playList.ts', {
    'react-native-track-player': h.trackPlayer,
    'react-native-background-timer': h.backgroundTimer,
    '@/config': { defaultUrl: 'file:///empty.mp3' },
    '@/store/player/state': h.player,
    '@/store/setting/state': h.settings,
    './carLyric': h.api,
  })
  const song = { id: 'song-a', name: 'Song', singer: 'Artist', meta: { albumName: 'Album' } }
  await playlist.initTrackInfo(song, h.player.musicInfo)
  await new Promise(resolve => setImmediate(resolve))
  for (const item of [...queue, ...metadata]) {
    assert.equal(item.ucarLyricWhole, lrc)
    assert.equal(item.ucarLyricLine, 'First line')
    assert.equal(item.title, 'Song')
    assert.equal(item.lyric, lrc)
  }
  assert.equal(queue.length, 1)
  assert.equal(metadata.length, 1)
})
