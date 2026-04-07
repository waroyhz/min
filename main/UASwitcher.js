/* Use the same user agent as Chrome to improve site compatibility and increase fingerprinting resistance
see https://github.com/minbrowser/min/issues/657 for more information */

const defaultUserAgent = app.userAgentFallback
let hasCustomUserAgent = false
let newUserAgent

if (settings.get('customUserAgent')) {
  newUserAgent = settings.get('customUserAgent')
  hasCustomUserAgent = true
} else {
  // CJ Browser: Use full Chrome version (not zeroed) to match real Chrome fingerprint
  newUserAgent = defaultUserAgent.replace(/Min\/\S+\s/, '').replace(/Electron\/\S+\s/, '').replace(/CJBrowser\/\S+\s/, '')
}
app.userAgentFallback = newUserAgent

function getFirefoxUA () {
  /**
   * @correction 260407143400 #1434: 修正 Windows 64位 Firefox UA。
   * WOW64 表示32位进程运行在64位系统——CJBrowser是原生64位，应用 Win64; x64。
   * 线上实际抓包: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0
   */
  const rootUAs = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:FXVERSION.0) Gecko/20100101 Firefox/FXVERSION.0',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:FXVERSION.0) Gecko/20100101 Firefox/FXVERSION.0',
    linux: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:FXVERSION.0) Gecko/20100101 Firefox/FXVERSION.0'
  }

  let rootUA
  if (process.platform === 'win32') {
    rootUA = rootUAs.windows
  } else if (process.platform === 'darwin') {
    rootUA = rootUAs.mac
  } else {
    // 'aix', 'freebsd', 'linux', 'openbsd', 'sunos'
    rootUA = rootUAs.linux
  }

  /*
  Guess at an appropriate Firefox version to use in the UA.
  We want a recent version (ideally the latest), but not a version that hasn't been released yet.
  New releases are every ~4 weeks, with some delays for holidays.
  @correction 260407145400 #1453: 修正发布周期常量从 4.1 → 4.15 周。
  线上真实 Firefox UA 为 149.0（2026-04-07），4.1 周算出 150（偏高 1）。
  实测 Firefox 91→149 共 58 版 / 1701 天 = 平均 29.3 天 ≈ 4.19 周。
  使用 4.15 周既匹配当前真实版本号(149)，又保持动态递增。
  */

  const fxVersion = 91 + Math.floor((Date.now() - 1628553600000) / (4.15 * 7 * 24 * 60 * 60 * 1000))

  return rootUA.replace(/FXVERSION/g, fxVersion)
}

/*
@correction 260407061500 #1304: REMOVED enableGoogleUASwitcher entirely.
This function registered session.webRequest.onBeforeSendHeaders which REPLACED
cjStealth._fixHttpHeaders handler (Electron only allows ONE handler per session).
Result: cjStealth's comprehensive header fixes (sec-ch-ua-full-version-list,
sec-ch-ua-platform, User-Agent cleanup) were silently discarded.
Google detected incomplete Client Hints and blocked login as "browser not safe".
All SEC-CH-UA headers are now handled exclusively by cjStealth._fixHttpHeaders.
*/
