import { Platform } from 'react-native'
import RNFS from 'react-native-fs'
import {
  Dirs,
  FileSystem,
  AndroidScoped,
  type OpenDocumentOptions,
  type Encoding,
  type HashAlgorithm,
  getExternalStoragePaths as _getExternalStoragePaths,
} from 'react-native-file-system'
import settingState from '@/store/setting/state'

export type {
  FileType,
} from 'react-native-file-system'

export const extname = (name: string) => name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1) : ''

export const temporaryDirectoryPath = Dirs.CacheDir
export const externalStorageDirectoryPath = Dirs.SDCardDir
export const privateStorageDirectoryPath = Dirs.DocumentDir

const MUSIC_DOWNLOAD_APP_FOLDER = 'lxmusic'

export const getMusicDownloadDirectoryPath = (savePath = settingState.setting['download.savePath']): string => {
  const customPath = savePath?.trim()
  if (customPath) return customPath.replace(/\/+/g, '/')
  if (Platform.OS === 'android') {
    const root = (RNFS.DownloadDirectoryPath ?? '').replace(/\/+$/, '')
    if (root.length > 0) {
      return `${root}/${MUSIC_DOWNLOAD_APP_FOLDER}`.replace(/\/+/g, '/')
    }
  }
  return `${privateStorageDirectoryPath}/download/${MUSIC_DOWNLOAD_APP_FOLDER}`.replace(/\/+/g, '/')
}

export const ensureMusicDownloadDirectory = async(savePath?: string): Promise<string> => {
  const dir = getMusicDownloadDirectoryPath(savePath)
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir)
  }
  return dir
}

export const existsMusicDownloadTarget = async(path: string): Promise<boolean> => {
  return RNFS.exists(path)
}

export interface MusicDownloadDirItem {
  name: string
  path: string
  isFile: boolean
  size: number
}

export const readMusicDownloadDirectory = async(): Promise<MusicDownloadDirItem[]> => {
  const dir = getMusicDownloadDirectoryPath()
  if (!(await RNFS.exists(dir))) return []
  if (Platform.OS === 'android') {
    const list = await RNFS.readDir(dir)
    return list.map(item => ({
      name: item.name,
      path: item.path,
      isFile: item.isFile(),
      size: typeof item.size === 'number' ? item.size : Number(item.size) || 0,
    }))
  }
  const list = await FileSystem.ls(dir)
  return list.map((item: {
    name: string
    path: string
    isFile?: boolean
    isDirectory?: boolean
    size?: number
  }) => ({
    name: item.name,
    path: item.path,
    isFile: item.isFile === true || item.isDirectory === false,
    size: item.size ?? 0,
  }))
}

export const scanMusicDownloadFile = async(path: string): Promise<void> => {
  if (Platform.OS !== 'android') return
  try {
    await RNFS.scanFile(path)
  } catch {}
}

export const removeMusicDownloadTarget = async(path: string): Promise<void> => {
  if (!(await RNFS.exists(path))) return
  await RNFS.unlink(path)
}

export const getExternalStoragePaths = async(is_removable?: boolean) => _getExternalStoragePaths(is_removable)

export const selectManagedFolder = async(isPersist: boolean = false) => AndroidScoped.openDocumentTree(isPersist)
export const selectFile = async(options: OpenDocumentOptions) => AndroidScoped.openDocument(options)
export const removeManagedFolder = async(path: string) => AndroidScoped.releasePersistableUriPermission(path)
export const getManagedFolders = async() => AndroidScoped.getPersistedUriPermissions()

export const getPersistedUriList = async() => AndroidScoped.getPersistedUriPermissions()


export const readDir = async(path: string) => FileSystem.ls(path)

export const unlink = async(path: string) => FileSystem.unlink(path)

export const mkdir = async(path: string) => FileSystem.mkdir(path)

export const stat = async(path: string) => FileSystem.stat(path)
export const hash = async(path: string, algorithm: HashAlgorithm) => FileSystem.hash(path, algorithm)

export const readFile = async(path: string, encoding?: Encoding) => FileSystem.readFile(path, encoding)

export const moveFile = async(fromPath: string, toPath: string) => FileSystem.mv(fromPath, toPath)
export const gzipFile = async(fromPath: string, toPath: string) => FileSystem.gzipFile(fromPath, toPath)
export const unGzipFile = async(fromPath: string, toPath: string) => FileSystem.unGzipFile(fromPath, toPath)
export const gzipString = async(data: string, encoding?: Encoding) => FileSystem.gzipString(data, encoding)
export const unGzipString = async(data: string, encoding?: Encoding) => FileSystem.unGzipString(data, encoding)

export const existsFile = async(path: string) => FileSystem.exists(path)

export const rename = async(path: string, name: string) => FileSystem.rename(path, name)

export const writeFile = async(path: string, data: string, encoding?: Encoding) => FileSystem.writeFile(path, data, encoding)

export const appendFile = async(path: string, data: string, encoding?: Encoding) => FileSystem.appendFile(path, data, encoding)

export const downloadFile = (url: string, path: string, options: Omit<RNFS.DownloadFileOptions, 'fromUrl' | 'toFile'> = {}) => {
  if (!options.headers) {
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
    }
  }
  return RNFS.downloadFile({
    fromUrl: url,
    toFile: path,
    ...options,
  })
}

export const stopDownload = (jobId: number) => {
  RNFS.stopDownload(jobId)
}
