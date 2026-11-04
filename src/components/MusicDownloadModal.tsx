import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import ConfirmAlert, { type ConfirmAlertType } from './common/ConfirmAlert'
import CheckBox from './common/CheckBox'
import Text from './common/Text'
import Button from './common/Button'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import settingState from '@/store/setting/state'
import { createStyle, toast } from '@/utils/tools'
import { sizeFormate } from '@/utils'
import { createDownloadFileName, getDownloadQualities } from '@/utils/download'
import { resolveDownloadSelection, type DownloadSelection } from '@/core/music/downloadInfo'
import { isMusicDownloading } from '@/core/music/downloader'

export interface MusicDownloadModalType {
  show: (musicInfo: LX.Music.MusicInfo) => void
}

interface Props {
  onDownload: (musicInfo: LX.Music.MusicInfoOnline, selection: DownloadSelection) => void
}

const Content = ({ musicInfo, onDownload, onHide }: Props & {
  musicInfo: LX.Music.MusicInfoOnline
  onHide: () => void
}) => {
  const t = useI18n()
  const theme = useTheme()
  const alertRef = useRef<ConfirmAlertType>(null)
  const choices = getDownloadQualities(musicInfo, global.lx.qualityList[musicInfo.source])
  const [quality, setQuality] = useState<LX.Quality | null>(() => {
    const preferred = settingState.setting['download.quality']
    return choices.find(item => item.supported && (item.quality === preferred || item.id === preferred))?.quality ??
      choices.find(item => item.supported)?.quality ?? null
  })
  const [selection, setSelection] = useState<DownloadSelection | null>(null)
  const [sizes, setSizes] = useState<Partial<Record<LX.Quality, number>>>({})
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const confirmed = useRef(false)

  useEffect(() => { alertRef.current?.setVisible(true) }, [])
  useEffect(() => {
    const controller = new AbortController()
    setSelection(null)
    setError('')
    if (quality) {
      setBusy(true)
      void resolveDownloadSelection(musicInfo, quality, controller.signal).then(info => {
        if (controller.signal.aborted) return
        setSelection(info)
        if (info.size) setSizes(prev => ({ ...prev, [quality]: info.size! }))
      }).catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message || t('download_failed'))
      }).finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    }
    return () => { controller.abort() }
  }, [musicInfo, quality, retry, t])

  const confirm = () => {
    if (!selection || selection.quality !== quality || busy || confirmed.current) return
    confirmed.current = true
    alertRef.current?.setVisible(false)
    onDownload(musicInfo, selection)
  }

  return (
    <ConfirmAlert
      ref={alertRef}
      title={t('download_select_quality')}
      confirmText={t('download_confirm')}
      disabledConfirm={busy || !selection || selection.quality !== quality}
      onConfirm={confirm}
      onHide={onHide}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{musicInfo.name} - {musicInfo.singer}</Text>
        {choices.map(item => (
          <CheckBox
            key={item.id}
            check={quality === item.quality}
            disabled={!item.supported}
            need
            marginBottom={6}
            onChange={() => { setSelection(null); setQuality(item.quality) }}
          >
            <View style={styles.option}>
              <Text color={item.supported ? theme['c-font'] : theme['c-500']}>{t(item.label)}</Text>
              <Text size={12} color={theme['c-500']}>
                {!item.supported ? t('download_quality_unsupported') : sizes[item.quality]
                  ? sizeFormate(sizes[item.quality]!)
                  : item.size ?? (busy && quality === item.quality ? t('download_size_loading') : t('download_size_unknown'))}
              </Text>
            </View>
          </CheckBox>
        ))}
        {quality ? <Text size={12} style={styles.preview}>
          {createDownloadFileName(settingState.setting['download.fileName'], musicInfo, quality)}{selection ? `.${selection.ext}` : ''}
        </Text> : null}
        {error ? <View>
          <Text size={12}>{error}</Text>
          <Button onPress={() => { setRetry(value => value + 1) }} style={styles.retry}>
            <Text color={theme['c-primary']}>{t('download_retry')}</Text>
          </Button>
        </View> : null}
      </View>
    </ConfirmAlert>
  )
}

export default forwardRef<MusicDownloadModalType, Props>(({ onDownload }, ref) => {
  const [musicInfo, setMusicInfo] = useState<LX.Music.MusicInfoOnline | null>(null)
  useImperativeHandle(ref, () => ({
    show(info) {
      if (info.source === 'local') return
      if (isMusicDownloading(info)) {
        toast(global.i18n.t('download_start', { name: info.name }))
        return
      }
      setMusicInfo(info)
    },
  }))
  return musicInfo
    ? <Content key={`${musicInfo.source}:${musicInfo.id}`} musicInfo={musicInfo} onDownload={onDownload} onHide={() => { setMusicInfo(null) }} />
    : null
})

const styles = createStyle({
  content: { flexShrink: 1, maxWidth: 460 },
  title: { marginBottom: 12 },
  option: { flexShrink: 1, paddingVertical: 2 },
  preview: { marginTop: 8, marginBottom: 4 },
  retry: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 12 },
})
