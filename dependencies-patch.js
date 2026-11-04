const path = require('node:path')
const { patchCarLyrics } = require('./scripts/patch-car-lyrics.cjs')
const { patchMediaControls } = require('./scripts/patch-media-controls.cjs')
const { patchDownloadTimeouts } = require('./scripts/patch-download-timeouts.cjs')

try {
  patchCarLyrics(path.join(__dirname, 'node_modules/react-native-track-player'))
  patchMediaControls(path.join(__dirname, 'node_modules/react-native-track-player'))
  patchDownloadTimeouts(path.join(__dirname, 'node_modules/react-native-fs'))
  console.log('Car lyric, media control and download dependency patches applied.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

