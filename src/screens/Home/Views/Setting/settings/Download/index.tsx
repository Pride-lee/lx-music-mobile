import { memo } from 'react'

import SavePath from './SavePath'
import DownloadQuality from './DownloadQuality'
import FileNameFormat from './FileNameFormat'
import AdditionalOptions from './AdditionalOptions'

export default memo(() => {
  return (
    <>
      <SavePath />
      <DownloadQuality />
      <FileNameFormat />
      <AdditionalOptions />
    </>
  )
})
