import 'react-native-track-player/lib/interfaces'

// Matches the native fields installed by scripts/patch-car-lyrics.cjs.
declare module 'react-native-track-player/lib/interfaces' {
  interface TrackMetadataBase {
    ucarLyricLine?: string
    ucarLyricWhole?: string
  }

  interface NowPlayingTitles {
    ucarLyricLine?: string
    ucarLyricWhole?: string
  }
}
