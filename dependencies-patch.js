const path = require('node:path')
const { patchCarLyrics } = require('./scripts/patch-car-lyrics.cjs')

try {
  patchCarLyrics(path.join(__dirname, 'node_modules/react-native-track-player'))
  console.log('Car lyric dependency patches applied.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

