import { compareVer } from '@/utils'
import { downloadNewVersion, getVersionInfo, updateApp } from '@/utils/version'
import versionActions from '@/store/version/action'
import versionState, { type InitState } from '@/store/version/state'
import { getIgnoreVersion, getIgnoreVersionFailTipTime, saveIgnoreVersion, saveIgnoreVersionFailTipTime } from '@/utils/data'
import { showVersionModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'
import { toast } from '@/utils/tools'

export const showModal = () => {
  if (versionState.showModal) return
  versionActions.setVisibleModal(true)
  showVersionModal()
}

export const hideModal = (componentId: string) => {
  if (!versionState.showModal) return
  versionActions.setVisibleModal(false)
  void Navigation.dismissOverlay(componentId)
}

export const checkUpdate = async() => {
  versionActions.setVersionInfo({ status: 'checking', errorMessage: '' })
  let versionInfo: InitState['versionInfo'] = { ...versionState.versionInfo }
  try {
    const { version, desc, history } = await getVersionInfo()
    versionInfo.newVersion = {
      version,
      desc,
      history,
    }
  } catch (err) {
    versionInfo.newVersion = {
      version: '0.0.0',
      desc: '',
      history: [],
    }
  }
  // const versionInfo = {
  //   version: '1.9.0',
  //   desc: '- 更新xxx\n- 修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达修复xxx123的萨达',
  //   history: [{ version: '1.8.0', desc: '- 更新xxx22\n- 修复xxx22' }, { version: '1.7.0', desc: '- 更新xxx22\n- 修复xxx22' }],
  // }
  if (versionInfo.newVersion.version == '0.0.0') {
    versionInfo.isUnknown = true
    versionInfo.status = 'error'
  } else {
    versionInfo.status = 'idle'
    versionInfo.isUnknown = false
    versionInfo.isLatest = compareVer(versionInfo.version, versionInfo.newVersion.version) != -1
  }

  versionActions.setVersionInfo(versionInfo)

  if (!versionInfo.isLatest) {
    if (versionInfo.isUnknown) {
      const time = await getIgnoreVersionFailTipTime()
      if (Date.now() - time < 7 * 86400000) return
      saveIgnoreVersionFailTipTime(Date.now())
      toast(global.i18n.t('version_tip_unknown'))
    } else if (versionInfo.newVersion.version != await getIgnoreVersion()) {
      showModal()
    }
  }
  // console.log(compareVer(process.versions.app, versionInfo.version))
  // console.log(process.versions.app, versionInfo.version)
}

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

export const installUpdate = async() => {
  versionActions.setVersionInfo({ errorMessage: '' })
  try {
    await updateApp()
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    const invalidApk = code == 'APK_INVALID' || code == 'APK_MISSING' || code == 'APK_PACKAGE_MISMATCH'
    versionActions.setVersionInfo({
      status: invalidApk ? 'error' : 'downloaded',
      errorMessage: getErrorMessage(error),
    })
  }
}

export const downloadUpdate = () => {
  if (versionState.versionInfo.status == 'downloading') return
  versionActions.setVersionInfo({ status: 'downloading', errorMessage: '' })
  versionActions.setProgress({ total: 0, current: 0 })

  downloadNewVersion(versionState.versionInfo.newVersion!.version, (total: number, current: number) => {
    // console.log(total, current)
    versionActions.setProgress({ total, current })
  }).then(async() => {
    versionActions.setVersionInfo({ status: 'downloaded' })
    await installUpdate()
  }).catch((error: unknown) => {
    versionActions.setVersionInfo({ status: 'error', errorMessage: getErrorMessage(error) })
  })
}


export const setIgnoreVersion = (version: InitState['ignoreVersion']) => {
  versionActions.setIgnoreVersion(version)
  saveIgnoreVersion(version)
}
