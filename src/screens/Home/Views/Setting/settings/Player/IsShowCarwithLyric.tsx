import { memo } from 'react'
import { View } from 'react-native'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const enabled = useSettingValue('player.isShowCarwithLyric')

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={enabled}
        onChange={(value) => { updateSetting({ 'player.isShowCarwithLyric': value }) }}
        label={t('setting_play_show_carwith_lyric')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
