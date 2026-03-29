const electron = require('electron')
const fs = require('fs')
const path = require('path')

const {
  app, // Module to control application life.
  protocol, // Module to control protocol handling
  BaseWindow, // Module to create native browser window.
  BrowserWindow,
  webContents,
  session,
  ipcMain: ipc,
  Menu, MenuItem,
  crashReporter,
  dialog,
  nativeTheme,
  shell,
  net,
  WebContentsView
} = electron

crashReporter.start({
  submitURL: 'https://www.cjdropshipping.com/',
  uploadToServer: false,
  compress: true
})

if (process.argv.some(arg => arg === '-v' || arg === '--version')) {
  console.log('CJ Browser: ' + app.getVersion())
  console.log('Chromium: ' + process.versions.chrome)
  process.exit()
}

let isInstallerRunning = false
const isDevelopmentMode = process.argv.some(arg => arg === '--development-mode')
const isDebuggingEnabled = process.argv.some(arg => arg === '--debug-browser')

function clamp (n, min, max) {
  return Math.max(Math.min(n, max), min)
}

if (process.platform === 'win32') {
  (async function () {
    try {
      var squirrelCommand = process.argv[1]
      if (squirrelCommand === '--squirrel-install' || squirrelCommand === '--squirrel-updated') {
        isInstallerRunning = true
        await registryInstaller.install()
      }
      if (squirrelCommand === '--squirrel-uninstall') {
        isInstallerRunning = true
        await registryInstaller.uninstall()
      }
      if (require('electron-squirrel-startup')) {
        app.quit()
      }
    } catch (e) {
      console.warn('[CJ Browser] Squirrel startup handler error (safe to ignore for NSIS installs):', e.message)
    }
  })()
}

// CJ Browser: Global error handlers to prevent blocking popup dialogs
process.on('uncaughtException', function (err) {
  console.error('[CJ Browser] Uncaught exception:', err.message, err.stack)
})
process.on('unhandledRejection', function (reason) {
  console.error('[CJ Browser] Unhandled rejection:', reason)
})

if (isDevelopmentMode) {
  app.setPath('userData', app.getPath('userData') + '-development')
}

// workaround for flicker when focusing app (https://github.com/electron/electron/issues/17942)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true')

// CJ Browser: Anti-automation detection — prevents navigator.webdriver = true
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

// CJ Browser: Disable Client Hints to prevent Sec-CH-UA header exposing non-Chrome identity
// (Chromium's Sec-CH-UA only includes "Chromium" brand, missing "Google Chrome" — signals non-standard browser to CF)
app.commandLine.appendSwitch('disable-features', 'UserAgentClientHint')

var cjPlaywrightCDPPort = parseInt(process.env.CJ_PLAYWRIGHT_CDP_PORT || '9222', 10)
if (!isNaN(cjPlaywrightCDPPort) && cjPlaywrightCDPPort > 0) {
  // Check port availability and auto-increment if in use
  var cjCpExec = require('child_process')
  var maxPortAttempts = 10
  for (var portAttempt = 0; portAttempt < maxPortAttempts; portAttempt++) {
    var testCdpPort = cjPlaywrightCDPPort + portAttempt
    try {
      if (process.platform === 'win32') {
        cjCpExec.execSync('netstat -ano | findstr "LISTENING" | findstr ":' + testCdpPort + ' "', { stdio: 'ignore' })
      } else {
        cjCpExec.execSync('lsof -i :' + testCdpPort + ' -sTCP:LISTEN', { stdio: 'ignore' })
      }
      // Command succeeded = port is in use, try next
      console.log('[CJ Browser] CDP port ' + testCdpPort + ' in use, trying ' + (testCdpPort + 1))
    } catch (e) {
      // Command failed = port is free
      cjPlaywrightCDPPort = testCdpPort
      break
    }
  }
  if (cjPlaywrightCDPPort !== parseInt(process.env.CJ_PLAYWRIGHT_CDP_PORT || '9222', 10)) {
    console.log('[CJ Browser] Using CDP port ' + cjPlaywrightCDPPort + ' (auto-incremented)')
  }
  app.commandLine.appendSwitch('remote-debugging-port', String(cjPlaywrightCDPPort))
}

// CJ Browser: Copiable error dialog utility
function showCopyableError (title, message, detail) {
  var errorWin = new BrowserWindow({
    width: 520,
    height: 320,
    title: title || 'CJ Browser Error',
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  var safeTitle = (title || 'Error').replace(/'/g, '&#39;').replace(/</g, '&lt;')
  var safeMsg = (message || '').replace(/'/g, '&#39;').replace(/</g, '&lt;')
  var safeDetail = (detail || '').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
  var html = 'data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + safeTitle + '</title>'
    + '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px;margin:0;background:#fff;}'
    + 'h3{color:#f44336;margin:0 0 12px;}p{color:#333;margin:0 0 12px;user-select:text;}'
    + 'pre{background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px;overflow:auto;'
    + 'max-height:150px;user-select:text;white-space:pre-wrap;word-break:break-all;}'
    + 'button{padding:8px 24px;background:#ff6b35;color:#fff;border:none;border-radius:6px;'
    + 'cursor:pointer;font-size:14px;}button:hover{opacity:.9;}'
    + '.actions{text-align:right;margin-top:16px;}'
    + '</style></head><body>'
    + '<h3>' + safeTitle + '</h3>'
    + '<p>' + safeMsg + '</p>'
    + (safeDetail ? '<pre>' + safeDetail + '</pre>' : '')
    + '<div class="actions"><button onclick="window.close()">关闭</button></div>'
    + '</body></html>')
  errorWin.setMenu(null)
  errorWin.loadURL(html)
}

var userDataPath = app.getPath('userData')

settings.initialize(userDataPath)

// CJ Browser: Default language to Chinese if not set
if (!settings.get('userSelectedLanguage')) {
  settings.set('userSelectedLanguage', 'zh-CN')
}
if (settings.get('userSelectedLanguage')) {
  app.commandLine.appendSwitch('lang', settings.get('userSelectedLanguage'))
}

const browserPage = 'min://app/index.html'

var mainMenu = null
var secondaryMenu = null
var isFocusMode = false
var appIsReady = false

const isFirstInstance = app.requestSingleInstanceLock()

if (!isFirstInstance) {
  app.quit()
  return
}

var saveWindowBounds = function () {
  if (windows.getCurrent()) {
    var bounds = Object.assign(windows.getCurrent().getBounds(), {
      maximized: windows.getCurrent().isMaximized()
    })
    fs.writeFileSync(path.join(userDataPath, 'windowBounds.json'), JSON.stringify(bounds))
  }
}

/**
 * @correction 第24次提交(#23补充#9): 包裹整个函数体防止"Render frame was disposed"崩溃。
 * 当窗口WebContents在IPC发送过程中被销毁时（如关闭窗口），会抛出异常。
 */
function sendIPCToWindow (window, action, data) {
  try {
    if (window && window.isDestroyed()) {
      return
    }

    if (window && getWindowWebContents(window).isLoadingMainFrame()) {
      // immediately after a did-finish-load event, isLoading can still be true,
      // so wait a bit to confirm that the page is really loading
      setTimeout(function() {
        try {
          if (window.isDestroyed()) return
          if (getWindowWebContents(window).isLoadingMainFrame()) {
            getWindowWebContents(window).once('did-finish-load', function () {
              try { getWindowWebContents(window).send(action, data || {}) } catch (e) {}
            })
          } else {
            getWindowWebContents(window).send(action, data || {})
          }
        } catch (e) { /* Render frame disposed during deferred send */ }
      }, 0)
    } else if (window) {
      getWindowWebContents(window).send(action, data || {})
    } else {
      var window = createWindow()
      getWindowWebContents(window).once('did-finish-load', function () {
        try { getWindowWebContents(window).send(action, data || {}) } catch (e) {}
      })
    }
  } catch (e) {
    // Render frame was disposed before WebFrameMain could be accessed — safe to ignore
  }
}

function openTabInWindow (url) {
  sendIPCToWindow(windows.getCurrent(), 'addTab', {
    url: url
  })
}

function handleCommandLineArguments (argv) {
  // the "ready" event must occur before this function can be used
  if (argv) {
    argv.forEach(function (arg, idx) {
      if (arg && arg.toLowerCase() !== __dirname.toLowerCase()) {
        // URL
        if (arg.indexOf('://') !== -1) {
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: arg
          })
        } else if (idx > 0 && argv[idx - 1] === '-s') {
          // search
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: arg
          })
        } else if (/\.(m?ht(ml)?|pdf)$/.test(arg) && fs.existsSync(arg)) {
          // local files (.html, .mht, mhtml, .pdf)
          sendIPCToWindow(windows.getCurrent(), 'addTab', {
            url: 'file://' + path.resolve(arg)
          })
        }
      }
    })
  }
}

function createWindow (customArgs = {}) {
  var bounds;

  try {
    var data = fs.readFileSync(path.join(userDataPath, 'windowBounds.json'), 'utf-8')
    bounds = JSON.parse(data)
  } catch (e) {}

  if (!bounds) { // there was an error, probably because the file doesn't exist
    var size = electron.screen.getPrimaryDisplay().workAreaSize
    bounds = {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      maximized: true
    }
  }

  // make the bounds fit inside a currently-active screen
  // (since the screen Min was previously open on could have been removed)
  // see: https://github.com/minbrowser/min/issues/904
  var containingRect = electron.screen.getDisplayMatching(bounds).workArea

  bounds = {
    x: clamp(bounds.x, containingRect.x, (containingRect.x + containingRect.width) - bounds.width),
    y: clamp(bounds.y, containingRect.y, (containingRect.y + containingRect.height) - bounds.height),
    width: clamp(bounds.width, 0, containingRect.width),
    height: clamp(bounds.height, 0, containingRect.height),
    maximized: bounds.maximized
  }

  return createWindowWithBounds(bounds, customArgs)
}

function createWindowWithBounds (bounds, customArgs) {
  const windowIconPath = path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon256.ico' : 'icon512.png')

  const newWin = new BaseWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: (process.platform === 'win32' ? 400 : 320), // controls take up more horizontal space on Windows
    minHeight: 350,
    titleBarStyle: settings.get('useSeparateTitlebar') ? 'default' : 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    icon: windowIconPath,
    frame: settings.get('useSeparateTitlebar'),
    alwaysOnTop: settings.get('windowAlwaysOnTop'),
    backgroundColor: '#fff', // the value of this is ignored, but setting it seems to work around https://github.com/electron/electron/issues/10559
  })

  // windows and linux always use a menu button in the upper-left corner instead
  // if frame: false is set, this won't have any effect, but it does apply on Linux if "use separate titlebar" is enabled
  if (process.platform !== 'darwin') {
    newWin.setMenuBarVisibility(false)
  }

  const mainView = new WebContentsView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: true, // used by ProcessSpawner
      additionalArguments: [
        '--user-data-path=' + userDataPath,
        '--app-version=' + app.getVersion(),
        '--app-name=' + app.getName(),
        ...((isDevelopmentMode ? ['--development-mode'] : [])),
        '--window-id=' + windows.nextId,
        ...((windows.getAll().length === 0 ? ['--initial-window'] : [])),
        ...(windows.hasEverCreatedWindow ? [] : ['--launch-window']),
        ...(customArgs.initialTask ? ['--initial-task=' + customArgs.initialTask] : [])
      ]
    }
  })
  mainView.webContents.loadURL(browserPage)

  if (bounds.maximized) {
    newWin.maximize()

    mainView.webContents.once('did-finish-load', function () {
      sendIPCToWindow(newWin, 'maximize')
    })
  }

  const winBounds = newWin.getContentBounds()

  mainView.setBounds({x: 0, y: 0, width: winBounds.width, height: winBounds.height})
  newWin.contentView.addChildView(mainView)

  // sometimes getContentBounds doesn't provide correct bounds until after the window has finished loading
  mainView.webContents.once('did-finish-load', function () {
    const winBounds = newWin.getContentBounds()
    mainView.setBounds({x: 0, y: 0, width: winBounds.width, height: winBounds.height})
    // CJ Browser: Send domain list and status to newly loaded window
    try {
      getWindowWebContents(newWin).send('cj-domains-updated', cjConfig.getDomains())
      getWindowWebContents(newWin).send('cj-proxy-status', { enabled: typeof cjProxyEnabled !== 'undefined' ? cjProxyEnabled : false, source: typeof cjProxySource !== 'undefined' ? cjProxySource : 'none', loggedIn: !!(cjAuth && cjAuth.getToken()) })
      if (cjConfig.getEnvironment() !== 'production') {
        getWindowWebContents(newWin).send('cj-env-changed', cjConfig.getEnvironmentInfo())
      }
    } catch (e) {
      // config may not be loaded yet
    }  })

  mainView.webContents.ipc.on('set-window-title', function(e, title) {
    newWin.title = title
  })

  newWin.on('resize', function () {
    // The result of getContentBounds doesn't update until the next tick
    setTimeout(function () {
      const winBounds = newWin.getContentBounds()
      mainView.setBounds({x: 0, y: 0, width: winBounds.width, height: winBounds.height})
    }, 0)
  })

  newWin.on('close', function () {
    // save the window size for the next launch of the app
    saveWindowBounds()
  })

  newWin.on('focus', function () {
    if (!windows.getState(newWin).isMinimized) {
      sendIPCToWindow(newWin, 'windowFocus')
    }
  })

  newWin.on('minimize', function () {
    sendIPCToWindow(newWin, 'minimize')
    windows.getState(newWin).isMinimized = true
  })

  newWin.on('restore', function () {
    windows.getState(newWin).isMinimized = false
  })

  newWin.on('maximize', function () {
    sendIPCToWindow(newWin, 'maximize')
  })

  newWin.on('unmaximize', function () {
    sendIPCToWindow(newWin, 'unmaximize')
  })
  
  newWin.on('focus', function () {
    sendIPCToWindow(newWin, 'focus')
  })

  newWin.on('blur', function () {
    // if the devtools for this window are focused, this check will be false, and we keep the focused class on the window
    if (BaseWindow.getFocusedWindow() !== newWin) {
      sendIPCToWindow(newWin, 'blur')
    }
  })

  newWin.on('enter-full-screen', function () {
    sendIPCToWindow(newWin, 'enter-full-screen')
  })

  newWin.on('leave-full-screen', function () {
    sendIPCToWindow(newWin, 'leave-full-screen')
    // https://github.com/minbrowser/min/issues/1093
    newWin.setMenuBarVisibility(false)
  })

  newWin.on('enter-html-full-screen', function () {
    sendIPCToWindow(newWin, 'enter-html-full-screen')
  })

  newWin.on('leave-html-full-screen', function () {
    sendIPCToWindow(newWin, 'leave-html-full-screen')
    // https://github.com/minbrowser/min/issues/952
    newWin.setMenuBarVisibility(false)
  })

  /*
  Handles events from mouse buttons
  Unsupported on macOS, and on Linux, there is a default handler already,
  so registering a handler causes events to happen twice.
  See: https://github.com/electron/electron/issues/18322
  */
  if (process.platform === 'win32') {
    newWin.on('app-command', function (e, command) {
      if (command === 'browser-backward') {
        sendIPCToWindow(newWin, 'goBack')
      } else if (command === 'browser-forward') {
        sendIPCToWindow(newWin, 'goForward')
      }
    })
  }

  // prevent remote pages from being loaded using drag-and-drop, since they would have node access
  mainView.webContents.on('will-navigate', function (e, url) {
    if (url !== browserPage) {
      e.preventDefault()
    }
  })

  mainView.webContents.on('before-input-event', function(e, input) {
    sendIPCToWindow(newWin, 'before-input-event', input)
  })

  newWin.setTouchBar(buildTouchBar())

  windows.addWindow(newWin)

  return newWin
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function () {
  settings.set('restartNow', false)
  appIsReady = true

  // CJ Browser: Set Dock icon on macOS (dev mode shows Electron default otherwise)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'icons', 'icon512.png'))
  }

  /* the installer launches the app to install registry items and shortcuts,
  but if that's happening, we shouldn't display anything */
  if (isInstallerRunning) {
    return
  }

  registerBundleProtocol(session.defaultSession)

  const newWin = createWindow()

  getWindowWebContents(newWin).on('did-finish-load', function () {
    // if a URL was passed as a command line argument (probably because Min is set as the default browser on Linux), open it.
    handleCommandLineArguments(process.argv)

    // there is a URL from an "open-url" event (on Mac)
    if (global.URLToOpen) {
      // if there is a previously set URL to open (probably from opening a link on macOS), open it
      sendIPCToWindow(newWin, 'addTab', {
        url: global.URLToOpen
      })
      global.URLToOpen = null
    }
  })

  mainMenu = buildAppMenu()
  Menu.setApplicationMenu(mainMenu)
  createDockMenu()

  // CJ Browser: Initialize CJ modules
  cjStealth.initialize()
  cjAuth.initialize(userDataPath)
  cjTracker.initialize()

  // Initialize environment configuration
  cjConfig.initializeEnv()

  // Fetch backend config, then PAC domains, then apply proxy
  cjConfig.fetchConfig(cjAuth.getToken()).then(function () {
    // Send domain list to all windows
    windows.getAll().forEach(function (win) {
      getWindowWebContents(win).send('cj-domains-updated', cjConfig.getDomains())
    })
    // Fetch PAC domains, then apply proxy
    return cjConfig.fetchPacDomains(cjAuth.getToken())
  }).then(function () {
    cjConfig.startPacRefresh()
    // Update proxy from backend config (now with PAC domains)
    if (typeof updateProxyFromConfig === 'function') {
      updateProxyFromConfig()
    }
  })

  // Initialize auto-updater
  cjUpdater.initialize()

  // CJ Browser: Initialize remote automation scripts manager
  cjScripts.initialize(userDataPath)

  // CJ Browser: Initialize AI Automation API
  cjAutomate.initialize()

  // CJ Browser: Handle SSL certificate errors (corporate proxy environments)
  app.on('certificate-error', function (event, webContents, url, error, certificate, callback) {
    // @correction #260329#5 minbrowser.org 证书过期是已知问题，静默处理
    if (url.indexOf('minbrowser.org') === -1) {
      console.warn('[CJ Browser] Certificate error for', url, ':', error)
    }
    event.preventDefault()
    callback(true)
  })

  // Track navigation events from all views
  ipc.on('cj-track-pageview', function (e, data) {
    cjTracker.trackPageView(data.url, data.title, data.tabId)
  })

  // CJ Browser: Get proxy status (sync handler for error page)
  ipc.on('cj-proxy-get-status', function (e) {
    e.returnValue = {
      enabled: typeof cjProxyEnabled !== 'undefined' ? cjProxyEnabled : false,
      source: typeof cjProxySource !== 'undefined' ? cjProxySource : 'none',
      mode: typeof cjProxyEnabled !== 'undefined' && cjProxyEnabled ? 'company' : 'direct'
    }
  })

  // CJ Browser: Proxy mode switching from sidebar
  ipc.on('cj-proxy-set-mode', function (e, mode) {
    if (mode === 'company') {
      if (typeof updateProxyFromConfig === 'function') {
        var result = updateProxyFromConfig()
        if (result && typeof result.then === 'function') {
          result.then(function (success) {
            if (!success) {
              // Notify sidebar that proxy switch failed
              windows.getAll().forEach(function (win) {
                getWindowWebContents(win).send('cj-proxy-refresh-current-tab', { mode: 'direct', reason: 'no-proxy-config' })
              })
            }
          })
        }
      }
    } else if (mode === 'direct') {
      if (typeof applyCJProxy === 'function') {
        applyCJProxy(false, 'direct')
      }
    }

    windows.getAll().forEach(function (win) {
      getWindowWebContents(win).send('cj-proxy-refresh-current-tab', {
        mode: mode
      })
    })
  })

  ipc.handle('cj-handle-load-failure', function (e, data) {
    if (cjConfig && typeof cjConfig.handleLoadFailure === 'function') {
      return cjConfig.handleLoadFailure(data)
    }
    return Promise.resolve({ handled: false })
  })
})

app.on('open-url', function (e, url) {
  if (appIsReady) {
    sendIPCToWindow(windows.getCurrent(), 'addTab', {
      url: url
    })
  } else {
    global.URLToOpen = url // this will be handled later in the createWindow callback
  }
})

// handoff support for macOS
app.on('continue-activity', function(e, type, userInfo, details) {
  if (type === 'NSUserActivityTypeBrowsingWeb' && details.webpageURL) {
    e.preventDefault()
    sendIPCToWindow(windows.getCurrent(), 'addTab', {
      url: details.webpageURL
    })
  }
})

app.on('second-instance', function (e, argv, workingDir) {
  if (windows.getCurrent()) {
    if (windows.getCurrent().isMinimized()) {
      windows.getCurrent().restore()
    }
    windows.getCurrent().focus()
    // add a tab with the new URL
    handleCommandLineArguments(argv)
  }
})

/**
 * Emitted when the application is activated, which usually happens when clicks on the applications's dock icon
 * https://github.com/electron/electron/blob/master/docs/api/app.md#event-activate-os-x
 *
 * Opens a new tab when all tabs are closed, and min is still open by clicking on the application dock icon
 */
app.on('activate', function (/* e, hasVisibleWindows */) {
  if (!windows.getCurrent() && appIsReady) { // sometimes, the event will be triggered before the app is ready, and creating new windows will fail
    createWindow()
  }
})

ipc.on('focusMainWebContents', function () {
  getWindowWebContents(windows.getCurrent()).focus()
})

ipc.on('showSecondaryMenu', function (event, data) {
  if (!secondaryMenu) {
    secondaryMenu = buildAppMenu({ secondary: true })
  }
  secondaryMenu.popup({
    x: data.x,
    y: data.y
  })
})

ipc.on('handoffUpdate', function(e, data) {
  if (app.setUserActivity && data.url && data.url.startsWith('http')) {
    app.setUserActivity('NSUserActivityTypeBrowsingWeb', {}, data.url)
  } else if (app.invalidateCurrentActivity) {
    app.invalidateCurrentActivity()
  }
})

ipc.on('quit', function () {
  cjAutomate.shutdown()
  app.quit()
})

ipc.on('tab-state-change', function(e, events) {
  const sourceWindowId = windows.windowFromContents(e.sender)?.id
  if (!sourceWindowId) {
    console.warn('warning: received tab state update from window after destruction, ignoring')
    return
  }
  windows.getAll().forEach(function(window) {
    if (getWindowWebContents(window).id !== e.sender.id) {
      getWindowWebContents(window).send('tab-state-change-receive', {
        sourceWindowId,
        events
      })
    }
  })
})

ipc.on('request-tab-state', function(e) {
  const otherWindow = windows.getAll().find(w => getWindowWebContents(w).id !== e.sender.id)
  if (!otherWindow) {
    throw new Error('secondary window doesn\'t exist as source for tab state')
  }
  ipc.once('return-tab-state', function(e2, data) {
    e.returnValue = data
  })
  getWindowWebContents(otherWindow).send('read-tab-state')
})

/* places service */

const placesPage = 'file://' + __dirname + '/js/places/placesService.html'

let placesWindow = null
app.once('ready', function() {
  placesWindow = new BrowserWindow({
    width: 300,
    height: 300,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  placesWindow.loadURL(placesPage)
})

ipc.on('places-connect', function (e) {
  placesWindow.webContents.postMessage('places-connect', null, e.ports)
})

function getWindowWebContents (win) {
  return win.getContentView().children[0].webContents
}

/* translate service */

const translatePage = 'min://app/pages/translateService/index.html'
const translatePreload = __dirname + '/pages/translateService/translateServicePreload.js'

app.on('ready', function() {
  ipc.on('page-translation-session-create', function(e) {
    let translateWindow = new BrowserWindow({
      width: 300,
      height: 300,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: translatePreload
      }
    })
  
    translateWindow.loadURL(translatePage)
    // translateWindow.webContents.openDevTools({mode: 'detach'})

    translateWindow.webContents.once('did-finish-load', function() {
      translateWindow.webContents.postMessage('page-translation-session-create', null, e.ports)
    })
  })
})
