/* CJ Browser - Auto Update Module (非阻塞版本检查) */

/* electron modules: app, dialog, ipc, shell, net are available from main.js */
/* cjConfig available from earlier concatenation */

var CJ_OSS_WINDOWS_LATEST_URL = 'https://cj-front-end.oss-cn-hangzhou.aliyuncs.com/CJBrowser/latest.json'
var CJ_OSS_MAC_ARM64_LATEST_URL = 'https://cj-front-end.oss-cn-hangzhou.aliyuncs.com/CJBrowser/latest-mac-arm64.json'
var CJ_OSS_MAC_X86_LATEST_URL = 'https://cj-front-end.oss-cn-hangzhou.aliyuncs.com/CJBrowser/latest-mac-x86.json'
var CJ_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000 // 每 30 分钟检查一次

var cjUpdater = {
  initialized: false,
  dismissed: false,
  lastNotifiedVersion: null,
  lastVersionInfo: null,
  checkTimer: null,

  initialize: function () {
    // 启动后 8 秒执行首次检查 (先让 PAC/Config 加载完)
    setTimeout(function () {
      cjUpdater.checkForUpdate()
    }, 8000)

    // 定时检查
    cjUpdater.checkTimer = setInterval(function () {
      cjUpdater.dismissed = false // 允许新一轮提醒
      cjUpdater.checkForUpdate()
    }, CJ_UPDATE_CHECK_INTERVAL_MS)

    cjUpdater.initialized = true

    // 手动检查
    ipc.on('cj-check-update', function () {
      cjUpdater.dismissed = false
      cjUpdater.checkForUpdate()
    })

    // 渲染层反馈: 用户点击下载
    ipc.on('cj-update-download', function (event, downloadUrl) {
      if (downloadUrl) {
        shell.openExternal(downloadUrl)
      }
    })

    // 渲染层反馈: 用户暂时忽略
    ipc.on('cj-update-dismiss', function () {
      cjUpdater.dismissed = true
    })

    console.log('[CJ Updater] Initialized (platform=' + cjUpdater.getPlatformKey() + ', oss-only, non-blocking)')
  },

  getPlatformKey: function () {
    if (process.platform === 'darwin') {
      return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x86'
    }
    return 'windows'
  },

  getPlatformLabel: function (platformKey) {
    switch (platformKey || cjUpdater.getPlatformKey()) {
      case 'mac-arm64':
        return 'macOS'
      case 'mac-x86':
        return 'macOS'
      default:
        return 'Windows'
    }
  },

  getLatestManifestUrl: function () {
    switch (cjUpdater.getPlatformKey()) {
      case 'mac-arm64':
        return CJ_OSS_MAC_ARM64_LATEST_URL
      case 'mac-x86':
        return CJ_OSS_MAC_X86_LATEST_URL
      default:
        return CJ_OSS_WINDOWS_LATEST_URL
    }
  },

  rememberVersionInfo: function (info) {
    if (!info || !info.latest) {
      return
    }

    cjUpdater.lastVersionInfo = {
      latest: info.latest,
      downloadUrl: info.downloadUrl || '',
      sha256: info.sha256 || '',
      releaseNotes: info.releaseNotes || '',
      source: info.source || 'oss',
      platformKey: info.platformKey || cjUpdater.getPlatformKey(),
      platformLabel: info.platformLabel || cjUpdater.getPlatformLabel(info.platformKey)
    }
  },

  getLatestVersionInfo: function () {
    return cjUpdater.lastVersionInfo
  },

  /**
   * 主检查流程: 直接查 OSS 平台版本索引
   */
  checkForUpdate: function () {
    cjUpdater.checkFromOSS().then(function (ossInfo) {
      if (ossInfo) {
        cjUpdater.rememberVersionInfo(ossInfo)
        cjUpdater.notifyIfNewer(ossInfo)
      }
    }).catch(function () {
      cjUpdater.lastVersionInfo = null
    })
  },

  /**
   * 从 OSS latest.json 获取最新版本
   */
  checkFromOSS: function () {
    return new Promise(function (resolve) {
      try {
        var manifestUrl = cjUpdater.getLatestManifestUrl()
        var platformKey = cjUpdater.getPlatformKey()
        var request = net.request({ method: 'GET', url: manifestUrl })
        var body = ''

        request.on('response', function (response) {
          response.on('data', function (chunk) { body += chunk.toString() })
          response.on('end', function () {
            try {
              var info = JSON.parse(body)
              if (info && info.version) {
                resolve({
                  latest: info.version,
                  downloadUrl: info.downloadUrl || '',
                  sha256: info.sha256 || '',
                  releaseNotes: info.releaseNotes || '',
                  source: 'oss',
                  platformKey: platformKey,
                  platformLabel: cjUpdater.getPlatformLabel(platformKey),
                  manifestUrl: manifestUrl
                })
              } else {
                resolve(null)
              }
            } catch (e) {
              resolve(null)
            }
          })
        })

        request.on('error', function () { resolve(null) })
        request.end()
      } catch (e) {
        resolve(null)
      }
    })
  },

  /**
   * 版本比较后发送非阻塞通知到渲染进程
   */
  notifyIfNewer: function (info) {
    var current = app.getVersion()
    var isNewer = cjUpdater.compareVersions(info.latest, current)

    if (isNewer <= 0) {
      return
    }

    // 已经提醒过同一版本且被用户忽略
    if (cjUpdater.dismissed && cjUpdater.lastNotifiedVersion === info.latest) {
      return
    }

    cjUpdater.lastNotifiedVersion = info.latest

    // 非阻塞: 发 IPC 到所有渲染窗口，由渲染层显示 toast
    var payload = {
      currentVersion: current,
      latestVersion: info.latest,
      downloadUrl: info.downloadUrl,
      releaseNotes: info.releaseNotes,
      source: info.source,
      platformKey: info.platformKey || cjUpdater.getPlatformKey(),
      platformLabel: info.platformLabel || cjUpdater.getPlatformLabel(info.platformKey)
    }

    console.log('[CJ Updater] New version available: v' + info.latest + ' (current: v' + current + ', source: ' + info.source + ')')

    windows.getAll().forEach(function (win) {
      try {
        getWindowWebContents(win).send('cj-update-available', payload)
      } catch (e) {}
    })
  },

  compareVersions: function (a, b) {
    var pa = String(a).split('.').map(Number)
    var pb = String(b).split('.').map(Number)
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = pa[i] || 0
      var nb = pb[i] || 0
      if (na > nb) return 1
      if (na < nb) return -1
    }
    return 0
  }
}

module.exports = cjUpdater
