import TrackPlayer from 'react-native-track-player'
import BackgroundTimer from 'react-native-background-timer'
import { addLyricPlayHook } from '@/plugins/lyric'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

let initialized = false
let musicId: string | null = null
let whole = ''
let line = ''
let resendTimer: number | null = null

export const getCarLyricMetadata = (targetId: string | null) => {
  const enabled = settingState.setting['player.isShowCarwithLyric'] &&
    targetId != null && targetId == musicId && targetId == playerState.musicInfo.id
  return {
    ucarLyricWhole: enabled ? whole : '',
    ucarLyricLine: enabled ? line : '',
  }
}

export const getFullLyric = (targetId: string | null) => {
  const sendFullLyric = settingState.setting['player.isShowCarwithLyric'] ||
    settingState.setting['player.isShowBluetoothFullLyric']
  return sendFullLyric && targetId != null && targetId == musicId &&
    targetId == playerState.musicInfo.id ? whole : ''
}

const sync = () => {
  const currentId = playerState.musicInfo.id
  void TrackPlayer.updateNowPlayingTitles({
    ...getCarLyricMetadata(currentId),
    lyric: getFullLyric(currentId),
  })
    .catch((error: unknown) => { console.warn('Car lyric metadata update failed', error) })
}

const cancelResend = () => {
  if (resendTimer == null) return
  BackgroundTimer.clearTimeout(resendTimer)
  resendTimer = null
}

const refresh = () => {
  cancelResend()
  if (!settingState.setting['player.isShowCarwithLyric']) return
  sync()
  const targetId = playerState.musicInfo.id
  // Some receivers attach after the first playback metadata update.
  resendTimer = BackgroundTimer.setTimeout(() => {
    resendTimer = null
    if (playerState.isPlay && playerState.musicInfo.id == targetId &&
      settingState.setting['player.isShowCarwithLyric']) sync()
  }, 1500)
}

export const setCarLyric = (lyric: string) => {
  musicId = lyric ? playerState.musicInfo.id : null
  whole = lyric
  line = ''
  if (!lyric) cancelResend()
  if (settingState.setting['player.isShowCarwithLyric'] || settingState.setting['player.isShowBluetoothFullLyric']) sync()
}

export const initCarLyric = () => {
  if (initialized) return
  initialized = true
  addLyricPlayHook((_index, text) => {
    line = text ?? ''
    if (settingState.setting['player.isShowCarwithLyric']) {
      void TrackPlayer.updateNowPlayingTitles({
        ucarLyricLine: getCarLyricMetadata(playerState.musicInfo.id).ucarLyricLine,
      }).catch((error: unknown) => { console.warn('Car lyric line update failed', error) })
    }
  })
  global.state_event.on('configUpdated', (keys: Array<keyof LX.AppSetting>) => {
    if (!keys.includes('player.isShowCarwithLyric') && !keys.includes('player.isShowBluetoothFullLyric')) return
    cancelResend()
    if (settingState.setting['player.isShowCarwithLyric'] && playerState.isPlay) refresh()
    else sync()
  })
  global.app_event.on('play', refresh)
  global.app_event.on('pause', cancelResend)
  global.app_event.on('error', cancelResend)
  global.app_event.on('stop', cancelResend)
  global.app_event.on('musicToggled', cancelResend)
}
