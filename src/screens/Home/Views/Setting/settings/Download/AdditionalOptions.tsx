import { memo } from 'react'
import SubTitle from '../../components/SubTitle'
import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()
  const metadata = useSettingValue('download.writeMetadata')
  const pic = useSettingValue('download.isEmbedPic')
  const lyric = useSettingValue('download.isEmbedLyric')
  const translation = useSettingValue('download.isEmbedLyricTranslation')
  const roma = useSettingValue('download.isEmbedLyricRoma')
  const enhanced = useSettingValue('download.isEmbedLyricAwlrc')
  return (
    <SubTitle title={t('download_options_title')}>
      <CheckBoxItem check={metadata} label={t('download_write_tags')} onChange={value => { updateSetting({ 'download.writeMetadata': value }) }} />
      <CheckBoxItem check={pic} label={t('setting_download_embed_pic')} onChange={value => { updateSetting({ 'download.isEmbedPic': value }) }} />
      <CheckBoxItem check={lyric} label={t('setting_download_embed_lyric')} onChange={value => { updateSetting({ 'download.isEmbedLyric': value }) }} />
      <CheckBoxItem check={translation} disabled={!lyric} label={t('setting_download_embed_lyric_translation')} onChange={value => { updateSetting({ 'download.isEmbedLyricTranslation': value }) }} />
      <CheckBoxItem check={roma} disabled={!lyric} label={t('setting_download_embed_lyric_roma')} onChange={value => { updateSetting({ 'download.isEmbedLyricRoma': value }) }} />
      <CheckBoxItem check={enhanced} disabled={!lyric} label={t('setting_download_embed_lyric_awlrc')} onChange={value => { updateSetting({ 'download.isEmbedLyricAwlrc': value }) }} />
    </SubTitle>
  )
})
