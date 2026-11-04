import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { DOWNLOAD_QUALITIES } from '@/utils/download'
import { useI18n } from '@/lang'

const useActive = (id: LX.Quality) => {
  const q = useSettingValue('download.quality')
  return useMemo(() => q == id, [q, id])
}

const Item = ({ id, name }: {
  id: LX.Quality
  name: string
}) => {
  const isActive = useActive(id)
  return <CheckBox marginRight={8} check={isActive} label={name} onChange={() => { updateSetting({ 'download.quality': id }) }} need />
}

export default memo(() => {
  const t = useI18n()

  return (
    <SubTitle title={t('download_default_quality')}>
      <View style={styles.list}>
        {DOWNLOAD_QUALITIES.map((q) => <Item name={t(q.label)} id={q.id} key={q.id} />)}
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
