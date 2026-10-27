const fs = require('node:fs')
const path = require('node:path')

const javaRoot = 'android/src/main/java/com/guichaguri/trackplayer/service'
const patches = [
  {
    file: `${javaRoot}/models/TrackMetadata.java`,
    replacements: [
      [
        '    public String lyric;',
        `    public String lyric;
    public String ucarLyricWhole;
    public String ucarLyricLine;`,
      ],
      [
        '      if (bundle.containsKey("rating")) {',
        `      if (bundle.containsKey("ucarLyricWhole")) {
        ucarLyricWhole = bundle.getString("ucarLyricWhole");
      }
      if (bundle.containsKey("ucarLyricLine")) {
        ucarLyricLine = bundle.getString("ucarLyricLine");
      }

      if (bundle.containsKey("rating")) {`,
      ],
      [
        '        if (duration > 0) {',
        `        if (ucarLyricWhole != null) {
            builder.putString("ucar.media.metadata.LYRICS_WHOLE", ucarLyricWhole);
        }
        if (ucarLyricLine != null) {
            builder.putString("ucar.media.metadata.LYRICS_LINE", ucarLyricLine);
        }

        if (duration > 0) {`,
      ],
    ],
  },
  {
    file: `${javaRoot}/metadata/MetadataManager.java`,
    replacements: [
      [
        '      if (data.containsKey("lyric")) {',
        `      if (data.containsKey("ucarLyricWhole")) {
        prevMetadata.putString("ucar.media.metadata.LYRICS_WHOLE", data.getString("ucarLyricWhole"));
      }
      if (data.containsKey("ucarLyricLine")) {
        prevMetadata.putString("ucar.media.metadata.LYRICS_LINE", data.getString("ucarLyricLine"));
      }
      if (data.containsKey("lyric")) {`,
      ],
      [
        `        MediaMetadataCompat.Builder metadata = track.toMediaMetadata();

        metadata.putBitmap`,
        `        MediaMetadataCompat.Builder metadata = prevMetadata != null
                ? prevMetadata : track.toMediaMetadata();

        metadata.putBitmap`,
      ],
    ],
  },
]

function patchSource(source, patch) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  let result = source.replace(/\r\n/g, '\n')
  for (const [before, after] of patch.replacements) {
    if (result.includes(after)) continue
    const index = result.indexOf(before)
    if (index < 0 || result.indexOf(before, index + before.length) !== -1) {
      throw new Error(`Car lyric patch does not match ${patch.file}; check the pinned track-player revision`)
    }
    result = result.replace(before, after)
  }
  return newline === '\n' ? result : result.replace(/\n/g, '\r\n')
}

function patchCarLyrics(root) {
  // Validate every source before writing; an upstream mismatch must fail the build.
  const files = patches.map(patch => {
    const file = path.join(root, patch.file)
    const source = fs.readFileSync(file, 'utf8')
    return { file, source, patched: patchSource(source, patch) }
  })
  for (const { file, source, patched } of files) {
    if (source !== patched) fs.writeFileSync(file, patched)
  }
}

module.exports = { patches, patchSource, patchCarLyrics }
