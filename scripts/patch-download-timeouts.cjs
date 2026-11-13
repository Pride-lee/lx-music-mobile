const fs = require('node:fs')
const path = require('node:path')
const { patchSource } = require('./patch-car-lyrics.cjs')

const patch = {
  file: 'android/src/main/java/com/rnfs/Downloader.java',
  replacements: [[
    `        connection.setConnectTimeout(5000);
        connection.connect();`,
    `        connection.setConnectTimeout(param.connectionTimeout);
        connection.setReadTimeout(param.readTimeout);
        connection.connect();`,
  ]],
}

function patchDownloadTimeouts(root) {
  const file = path.join(root, patch.file)
  const source = fs.readFileSync(file, 'utf8')
  const patched = patchSource(source, patch)
  if (source !== patched) fs.writeFileSync(file, patched)
}

module.exports = { patch, patchDownloadTimeouts }
