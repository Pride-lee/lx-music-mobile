import { memo, useEffect, useState } from 'react'
import { View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import CheckBox from '@/components/common/CheckBox'
import Input from '@/components/common/Input'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { createDownloadFileName, FILE_NAME_PRESETS, isValidDownloadTemplate } from '@/utils/download'

const sample: LX.Music.MusicInfoOnline = {
  id: '123',
  name: '晴天',
  singer: '周杰伦',
  source: 'kw',
  interval: null,
  meta: { songId: '123', albumName: '叶惠美', qualitys: [], _qualitys: {} },
}

export default memo(() => {
  const t = useI18n()
  const value = useSettingValue('download.fileName')
  const quality = useSettingValue('download.quality')
  const [draft, setDraft] = useState(value)
  const [custom, setCustom] = useState(!FILE_NAME_PRESETS.some(item => item === value))
  useEffect(() => {
    setDraft(value)
    setCustom(!FILE_NAME_PRESETS.some(item => item === value))
  }, [value])

  return (
    <SubTitle title={t('download_filename_title')}>
      <View>
        {FILE_NAME_PRESETS.map(item => (
          <CheckBox key={item} check={!custom && value === item} label={item} need onChange={() => {
            setCustom(false)
            setDraft(item)
            updateSetting({ 'download.fileName': item })
          }} />
        ))}
        <CheckBox check={custom} label={t('download_filename_custom')} need onChange={() => { setCustom(true) }}
          helpTitle={t('download_filename_title')} helpDesc={t('download_filename_help')} />
        {custom ? <View style={styles.editor}>
          <Input value={draft} onChangeText={setDraft} maxLength={160} accessibilityLabel={t('download_filename_title')} />
          <Button disabled={!isValidDownloadTemplate(draft) || value === draft.trim()} onPress={() => {
            updateSetting({ 'download.fileName': draft.trim() })
            toast(t('download_filename_saved'))
          }}>{t('download_filename_save')}</Button>
        </View> : null}
        <Text size={12} style={styles.preview}>{createDownloadFileName(custom ? draft : value, sample, quality)}</Text>
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  editor: { flexDirection: 'row', alignItems: 'center', marginTop: 6, maxWidth: 520 },
  preview: { marginTop: 6, marginBottom: 4 },
})
