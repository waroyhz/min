/* CJ Browser - AI Automation Control API */

/* electron modules: app, ipc, net, session, BrowserWindow, WebContentsView, fs, path are available from main.js */
/* CJ modules: cjAuth, cjConfig are available from earlier concatenation */
/* View functions: viewMap, getView, loadURLInView, createView, destroyView, getTabIDFromWebContents, getWindowFromViewContents, windows, getWindowWebContents, sendIPCToWindow */

var http = require('http')
var urlModule = require('url')

var cjAutomate = {
  server: null,
  port: 9223,
  configuredTokens: [],
  controlledTabs: {},
  pendingAuthTokens: [],
  lastAuthRequestTime: 0,

  initialize: function () {
    cjAutomate._loadConfiguredTokens()
    cjAutomate._startServer()
    console.log('[CJ Automate] AI Automation API initialized')
  },

  _loadConfiguredTokens: function () {
    // Auto-generate a debug token on startup for external tool access
    var debugToken = 'cjauto-' + Math.random().toString(36).substring(2) + Date.now().toString(36)
    cjAutomate.configuredTokens.push(debugToken)
    console.log('[CJ Automate] ========================================')
    console.log('[CJ Automate] Auto-generated debug token: ' + debugToken)
    console.log('[CJ Automate] ========================================')

    // Write to file for external tools to discover
    try {
      var tokensFile = path.join(app.getPath('userData'), 'cj-automate-tokens.json')
      fs.writeFileSync(tokensFile, JSON.stringify({ tokens: [debugToken] }), 'utf-8')
      console.log('[CJ Automate] Token written to: ' + tokensFile)
    } catch (e) {
      console.warn('[CJ Automate] Failed to write tokens file:', e.message)
    }

    // Also load any additional tokens from environment variable
    var envToken = process.env.CJ_AUTOMATE_TOKEN
    if (envToken) {
      cjAutomate.configuredTokens.push(envToken)
    }

    var envPort = process.env.CJ_AUTOMATE_PORT
    if (envPort && parseInt(envPort, 10) > 0) {
      cjAutomate.port = parseInt(envPort, 10)
    }
  },

  // ---- Token Validation ----

  _validateToken: function (req) {
    var authHeader = req.headers['authorization'] || ''
    if (authHeader.indexOf('Bearer ') !== 0) {
      return false
    }
    var token = authHeader.slice(7)
    if (!token) {
      return false
    }

    // Enterprise WeChat token (default, always accepted when logged in)
    if (cjAuth && cjAuth.token && token === cjAuth.token) {
      return true
    }

    // Configured static tokens
    for (var i = 0; i < cjAutomate.configuredTokens.length; i++) {
      if (token === cjAutomate.configuredTokens[i]) {
        return true
      }
    }

    // Popup-granted temporary tokens
    var now = Date.now()
    for (var j = 0; j < cjAutomate.pendingAuthTokens.length; j++) {
      var entry = cjAutomate.pendingAuthTokens[j]
      if (entry.token === token && entry.expires > now) {
        return true
      }
    }

    return false
  },

  // ---- Automation Status Indicator ----

  _automationOverlayJS: function (action, agentName) {
    if (action === 'show') {
      return '(function(){' +
        'if(document.getElementById("cj-auto-overlay"))return;' +
        'var overlay=document.createElement("div");' +
        'overlay.id="cj-auto-overlay";' +
        'overlay.style.cssText="position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:linear-gradient(90deg,#ff6b35,#ff8c42);color:#fff;text-align:center;' +
        'padding:6px 12px;font:bold 13px/1.4 sans-serif;pointer-events:none;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.3);";' +
        'overlay.textContent="\\u{1F916} AI\\u81EA\\u52A8\\u5316\\u63A7\\u5236\\u4E2D' +
        (agentName ? ' (' + agentName.replace(/'/g, '') + ')' : '') +
        ' \\u2014 \\u8BF7\\u52FF\\u624B\\u52A8\\u64CD\\u4F5C";' +
        'var blocker=document.createElement("div");' +
        'blocker.id="cj-auto-blocker";' +
        'blocker.style.cssText="position:fixed;top:30px;left:0;right:0;bottom:0;z-index:2147483646;' +
        'background:transparent;cursor:not-allowed;";' +
        'blocker.addEventListener("click",function(e){e.stopPropagation();e.preventDefault();},true);' +
        'blocker.addEventListener("keydown",function(e){e.stopPropagation();e.preventDefault();},true);' +
        'blocker.addEventListener("mousedown",function(e){e.stopPropagation();e.preventDefault();},true);' +
        'document.documentElement.appendChild(overlay);' +
        'document.documentElement.appendChild(blocker);' +
        '})()'
    }
    return '(function(){' +
      'var o=document.getElementById("cj-auto-overlay");if(o)o.remove();' +
      'var b=document.getElementById("cj-auto-blocker");if(b)b.remove();' +
      '})()'
  },

  _setTabControlled: function (tabId, agentName) {
    cjAutomate.controlledTabs[tabId] = { since: Date.now(), agent: agentName || 'AI Agent' }
    var wc = cjAutomate._getViewWebContents(tabId)
    if (wc && !wc.isDestroyed()) {
      wc.executeJavaScript(cjAutomate._automationOverlayJS('show', agentName || 'AI Agent')).catch(function () {})
    }
  },

  _releaseTabControl: function (tabId) {
    delete cjAutomate.controlledTabs[tabId]
    var wc = cjAutomate._getViewWebContents(tabId)
    if (wc && !wc.isDestroyed()) {
      wc.executeJavaScript(cjAutomate._automationOverlayJS('remove')).catch(function () {})
    }
  },

  // ---- Popup Authorization ----

  _showAuthPopup: function () {
    var now = Date.now()
    if (now - cjAutomate.lastAuthRequestTime < 60000) {
      var remaining = Math.ceil((60000 - (now - cjAutomate.lastAuthRequestTime)) / 1000)
      return Promise.reject(new Error('Authorization cooldown: ' + remaining + 's remaining'))
    }
    cjAutomate.lastAuthRequestTime = now

    return new Promise(function (resolve, reject) {
      var parentWin = windows.getCurrent()
      var popup = new BrowserWindow({
        width: 420,
        height: 220,
        parent: parentWin || undefined,
        modal: !!parentWin,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: 'CJ Browser - AI Automation Authorization',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      var crypto = require('crypto')
      var tempToken = crypto.randomBytes(32).toString('hex')

      var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<style>body{font-family:sans-serif;padding:30px;text-align:center;background:#f5f5f5;}' +
        'h3{color:#333;margin-bottom:15px;}p{color:#666;font-size:14px;margin-bottom:20px;}' +
        '.btn{display:inline-block;padding:10px 30px;margin:0 10px;border:none;border-radius:6px;' +
        'font-size:15px;cursor:pointer;}.allow{background:#4CAF50;color:#fff;}.deny{background:#f44336;color:#fff;}' +
        '</style></head><body>' +
        '<h3>AI Automation Authorization</h3>' +
        '<p>An external AI agent is requesting browser control permission. Allow?</p>' +
        '<button class="btn allow" onclick="document.title=\'AUTH_ALLOW\'">Allow (60s)</button>' +
        '<button class="btn deny" onclick="document.title=\'AUTH_DENY\'">Deny</button>' +
        '<script>setTimeout(function(){document.title="AUTH_TIMEOUT"},60000);</script>' +
        '</body></html>'

      popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      popup.setMenuBarVisibility(false)

      var resolved = false

      popup.webContents.on('page-title-updated', function (e, title) {
        if (resolved) return
        resolved = true
        if (title === 'AUTH_ALLOW') {
          var entry = { token: tempToken, expires: Date.now() + 60000 }
          cjAutomate.pendingAuthTokens.push(entry)
          setTimeout(function () {
            var idx = cjAutomate.pendingAuthTokens.indexOf(entry)
            if (idx >= 0) cjAutomate.pendingAuthTokens.splice(idx, 1)
          }, 60000)
          resolve({ token: tempToken, expiresIn: 60 })
        } else {
          reject(new Error('Authorization denied'))
        }
        popup.close()
      })

      popup.on('closed', function () {
        if (!resolved) {
          resolved = true
          reject(new Error('Authorization window closed'))
        }
      })
    })
  },

  // ---- HTTP Server ----

  _startServer: function () {
    cjAutomate.server = http.createServer(function (req, res) {
      try {
        res.setHeader('Connection', 'close')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        var parsed = urlModule.parse(req.url, true)
        var pathname = parsed.pathname

        // No auth required: /api/status, /api/skills, /api/version, /api/auth/request
        if (pathname !== '/api/status' && pathname !== '/api/skills' && pathname !== '/api/version' && pathname !== '/api/auth/request') {
          if (!cjAutomate._validateToken(req)) {
            cjAutomate._sendJson(res, 401, { error: 'Unauthorized', message: 'Valid Bearer token required' })
            return
          }
        }

        cjAutomate._route(req, res, pathname, parsed.query)
      } catch (e) {
        console.error('[CJ Automate] Request error:', e.message)
        try {
          cjAutomate._sendJson(res, 500, { error: 'Internal Server Error', message: e.message })
        } catch (e2) {}
      }
    })

    cjAutomate.server.listen(cjAutomate.port, '127.0.0.1', function () {
      console.log('[CJ Automate] HTTP API listening on http://127.0.0.1:' + cjAutomate.port)
    })

    cjAutomate.server.keepAliveTimeout = 1000

    cjAutomate.server.on('error', function (err) {
      if (err.code === 'EADDRINUSE') {
        console.warn('[CJ Automate] Port ' + cjAutomate.port + ' in use, trying ' + (cjAutomate.port + 1))
        cjAutomate.port++
        cjAutomate.server.listen(cjAutomate.port, '127.0.0.1')
      } else {
        console.error('[CJ Automate] Server error:', err.message)
      }
    })
  },

  _route: function (req, res, pathname, query) {
    var method = req.method

    if (method === 'GET' && pathname === '/api/status') {
      return cjAutomate._handleStatus(req, res)
    }
    if (method === 'GET' && pathname === '/api/skills') {
      return cjAutomate._handleSkills(req, res)
    }
    if (method === 'POST' && pathname === '/api/auth/request') {
      return cjAutomate._handleAuthRequest(req, res)
    }
    if (method === 'GET' && pathname === '/api/auth/status') {
      return cjAutomate._handleAuthStatus(req, res)
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
      return cjAutomate._handleTriggerLogin(req, res)
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      return cjAutomate._handleTriggerLogout(req, res)
    }
    if (method === 'GET' && pathname === '/api/proxy/status') {
      return cjAutomate._handleProxyStatus(req, res)
    }
    if (method === 'POST' && pathname === '/api/proxy/mode') {
      return cjAutomate._handleBodyRequest(req, function (body) {
        cjAutomate._handleSetProxyMode(res, body)
      })
    }
    if (method === 'GET' && pathname === '/api/version') {
      return cjAutomate._handleVersionCheck(req, res)
    }
    if (method === 'GET' && pathname === '/api/env') {
      return cjAutomate._handleGetEnv(req, res)
    }
    if (method === 'POST' && pathname === '/api/env') {
      return cjAutomate._handleBodyRequest(req, function (body) {
        cjAutomate._handleSwitchEnv(res, body)
      })
    }
    if (method === 'GET' && pathname === '/api/tabs') {
      return cjAutomate._handleListTabs(req, res)
    }
    if (method === 'POST' && pathname === '/api/tabs') {
      return cjAutomate._handleBodyRequest(req, function (body) {
        cjAutomate._handleCreateTab(res, body)
      })
    }

    var tabMatch = pathname.match(/^\/api\/tabs\/([^/]+)(?:\/(.+))?$/)
    if (tabMatch) {
      var tabId = tabMatch[1]
      var action = tabMatch[2] || ''

      if (method === 'GET' && action === '') return cjAutomate._handleGetTab(res, tabId)
      if (method === 'DELETE' && action === '') return cjAutomate._handleCloseTab(res, tabId)
      if (method === 'POST' && action === 'navigate') {
        return cjAutomate._handleBodyRequest(req, function (body) { cjAutomate._handleNavigate(res, tabId, body) })
      }
      if (method === 'POST' && action === 'execute') {
        return cjAutomate._handleBodyRequest(req, function (body) { cjAutomate._handleExecute(res, tabId, body) })
      }
      if (method === 'GET' && action === 'screenshot') return cjAutomate._handleScreenshot(res, tabId)
      if (method === 'GET' && action === 'content') return cjAutomate._handleGetContent(res, tabId)
      if (method === 'POST' && action === 'activate') return cjAutomate._handleActivateTab(res, tabId)
      if (method === 'POST' && action === 'control') {
        return cjAutomate._handleBodyRequest(req, function (body) { cjAutomate._handleControlTab(res, tabId, body) })
      }
      if (method === 'DELETE' && action === 'control') return cjAutomate._handleReleaseTab(res, tabId)
    }

    cjAutomate._sendJson(res, 404, { error: 'Not Found', message: 'Unknown endpoint: ' + pathname })
  },

  // ---- Request Helpers ----

  _handleBodyRequest: function (req, callback) {
    var bodyChunks = []
    var totalSize = 0
    var maxSize = 1048576

    req.on('data', function (chunk) {
      totalSize += chunk.length
      if (totalSize > maxSize) { req.destroy(); return }
      bodyChunks.push(chunk)
    })

    req.on('end', function () {
      if (totalSize > maxSize) return
      var rawBody = Buffer.concat(bodyChunks).toString('utf-8')
      var body = {}
      if (rawBody) { try { body = JSON.parse(rawBody) } catch (e) {} }
      callback(body)
    })
  },

  _sendJson: function (res, status, data) {
    var json = JSON.stringify(data)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json)
    })
    res.end(json)
  },

  // ---- Tab Helpers ----

  _getViewWebContents: function (tabId) {
    var view = getView(tabId)
    if (view && view.webContents) return view.webContents
    return null
  },

  _getAllTabInfo: function () {
    var tabs = []
    for (var id in viewMap) {
      var wc = viewMap[id].webContents
      if (wc && !wc.isDestroyed()) {
        var info = {
          id: id,
          url: wc.getURL(),
          title: wc.getTitle(),
          loading: wc.isLoading(),
          canGoBack: wc.canGoBack(),
          canGoForward: wc.canGoForward()
        }
        if (cjAutomate.controlledTabs[id]) {
          info.controlled = true
          info.controlAgent = cjAutomate.controlledTabs[id].agent
        }
        tabs.push(info)
      }
    }
    return tabs
  },

  // ---- API Handlers ----

  _handleStatus: function (req, res) {
    cjAutomate._sendJson(res, 200, {
      status: 'ok',
      browser: 'CJBrowser',
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      port: cjAutomate.port,
      authenticated: cjAutomate._validateToken(req),
      controlledTabs: Object.keys(cjAutomate.controlledTabs).length,
      proxyEnabled: typeof cjProxyEnabled !== 'undefined' ? cjProxyEnabled : false,
      loggedIn: !!(cjAuth && cjAuth.token),
      user: cjAuth ? cjAuth.currentUser : null,
      environment: cjConfig ? cjConfig.getEnvironmentInfo() : null
    })
  },

  _handleSkills: function (req, res) {
    cjAutomate._sendJson(res, 200, cjAutomate._getSkillsManifest())
  },

  _handleVersionCheck: function (req, res) {
    var current = app.getVersion()
    var result = { current: current, latest: current, updateAvailable: false, downloadUrl: '' }

    if (typeof cjUpdater !== 'undefined' && cjUpdater.lastNotifiedVersion) {
      result.latest = cjUpdater.lastNotifiedVersion
      result.updateAvailable = cjUpdater.compareVersions(cjUpdater.lastNotifiedVersion, current) > 0
    }

    var versionInfo = cjConfig ? cjConfig.getVersion() : null
    if (versionInfo && versionInfo.downloadUrl) {
      result.downloadUrl = versionInfo.downloadUrl
    }

    cjAutomate._sendJson(res, 200, result)
  },

  _handleListTabs: function (req, res) {
    cjAutomate._sendJson(res, 200, { tabs: cjAutomate._getAllTabInfo() })
  },

  _handleGetTab: function (res, tabId) {
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) {
      return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    }
    cjAutomate._sendJson(res, 200, {
      id: tabId, url: wc.getURL(), title: wc.getTitle(),
      loading: wc.isLoading(), canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward()
    })
  },

  _handleCreateTab: function (res, body) {
    var url = body.url || 'about:blank'
    var currentWindow = windows.getCurrent()
    if (!currentWindow) {
      return cjAutomate._sendJson(res, 500, { error: 'No browser window available' })
    }
    sendIPCToWindow(currentWindow, 'addTab', { url: url })
    cjAutomate._sendJson(res, 200, { success: true, message: 'Tab creation requested', url: url })
  },

  _handleCloseTab: function (res, tabId) {
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) {
      return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    }
    if (cjAutomate.controlledTabs[tabId]) cjAutomate._releaseTabControl(tabId)
    destroyView(tabId)
    cjAutomate._sendJson(res, 200, { success: true, tabId: tabId })
  },

  _handleNavigate: function (res, tabId, body) {
    var url = body.url
    if (!url) return cjAutomate._sendJson(res, 400, { error: 'Missing required field: url' })
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    var currentWindow = getWindowFromViewContents(wc) || windows.getCurrent()
    loadURLInView(tabId, url, currentWindow)
    cjAutomate._sendJson(res, 200, { success: true, tabId: tabId, url: url })
  },

  _handleExecute: function (res, tabId, body) {
    var code = body.code
    if (!code) return cjAutomate._sendJson(res, 400, { error: 'Missing required field: code' })
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    wc.executeJavaScript(code).then(function (result) {
      cjAutomate._sendJson(res, 200, { success: true, tabId: tabId, result: result })
    }).catch(function (err) {
      cjAutomate._sendJson(res, 200, { success: false, tabId: tabId, error: err.message })
    })
  },

  _handleScreenshot: function (res, tabId) {
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    wc.capturePage().then(function (image) {
      var png = image.toPNG()
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
      res.end(png)
    }).catch(function (err) {
      cjAutomate._sendJson(res, 500, { error: 'Screenshot failed', message: err.message })
    })
  },

  _handleGetContent: function (res, tabId) {
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    wc.executeJavaScript('document.documentElement.outerHTML').then(function (html) {
      cjAutomate._sendJson(res, 200, { success: true, tabId: tabId, html: html })
    }).catch(function (err) {
      cjAutomate._sendJson(res, 500, { error: 'Failed to get content', message: err.message })
    })
  },

  _handleActivateTab: function (res, tabId) {
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    var win = getWindowFromViewContents(wc) || windows.getCurrent()
    if (win) sendIPCToWindow(win, 'switchToTab', tabId)
    cjAutomate._sendJson(res, 200, { success: true, tabId: tabId })
  },

  _handleControlTab: function (res, tabId, body) {
    var wc = cjAutomate._getViewWebContents(tabId)
    if (!wc || wc.isDestroyed()) return cjAutomate._sendJson(res, 404, { error: 'Tab not found', tabId: tabId })
    var agentName = body.agent || 'AI Agent'
    cjAutomate._setTabControlled(tabId, agentName)
    cjAutomate._sendJson(res, 200, { success: true, tabId: tabId, controlled: true, agent: agentName })
  },

  _handleReleaseTab: function (res, tabId) {
    if (!cjAutomate.controlledTabs[tabId]) {
      return cjAutomate._sendJson(res, 404, { error: 'Tab not under automation control', tabId: tabId })
    }
    cjAutomate._releaseTabControl(tabId)
    cjAutomate._sendJson(res, 200, { success: true, tabId: tabId, controlled: false })
  },

  _handleAuthRequest: function (req, res) {
    cjAutomate._showAuthPopup().then(function (result) {
      cjAutomate._sendJson(res, 200, {
        success: true, token: result.token, expiresIn: result.expiresIn,
        message: 'Temporary token granted for ' + result.expiresIn + ' seconds'
      })
    }).catch(function (err) {
      cjAutomate._sendJson(res, 403, { success: false, error: err.message })
    })
  },

  _handleAuthStatus: function (req, res) {
    cjAutomate._sendJson(res, 200, {
      loggedIn: !!(cjAuth && cjAuth.token),
      user: cjAuth ? cjAuth.currentUser : null,
      authMethods: {
        wechat: !!(cjAuth && cjAuth.token),
        configuredTokens: cjAutomate.configuredTokens.length > 0,
        popupAuth: true
      }
    })
  },

  _handleTriggerLogin: function (req, res) {
    var loginUrl = cjConfig.getLoginUrl()
    sendIPCToWindow(windows.getCurrent(), 'addTab', {
      url: loginUrl
    })
    cjAutomate._sendJson(res, 200, { success: true, message: 'Navigating to ' + loginUrl + ' for login' })
  },

  _handleTriggerLogout: function (req, res) {
    if (cjAuth && typeof cjAuth.logout === 'function') {
      cjAuth.logout()
      cjAutomate._sendJson(res, 200, { success: true, message: 'Logged out, proxy disabled' })
    } else {
      cjAutomate._sendJson(res, 500, { error: 'Auth module not available' })
    }
  },

  _handleProxyStatus: function (req, res) {
    cjAutomate._sendJson(res, 200, {
      enabled: typeof cjProxyEnabled !== 'undefined' ? cjProxyEnabled : false,
      source: typeof cjProxySource !== 'undefined' ? cjProxySource : 'none',
      loggedIn: !!(cjAuth && cjAuth.token),
      message: (typeof cjProxyEnabled !== 'undefined' && cjProxyEnabled)
        ? '公司内部配置已启用'
        : '代理未启用'
    })
  },

  _handleSetProxyMode: function (res, body) {
    var mode = body.mode
    if (!mode || ['company', 'direct'].indexOf(mode) === -1) {
      return cjAutomate._sendJson(res, 400, { error: 'Missing or invalid mode. Valid: company, direct' })
    }
    if (mode === 'company') {
      if (typeof updateProxyFromConfig === 'function') {
        updateProxyFromConfig()
        cjAutomate._sendJson(res, 200, { success: true, mode: 'company', message: '已切换到公司代理' })
      } else {
        cjAutomate._sendJson(res, 500, { error: 'Proxy module not available' })
      }
    } else if (mode === 'direct') {
      if (typeof applyCJProxy === 'function') {
        applyCJProxy(false)
        cjAutomate._sendJson(res, 200, { success: true, mode: 'direct', message: '已切换到直连模式' })
      } else {
        cjAutomate._sendJson(res, 500, { error: 'Proxy module not available' })
      }
    }
  },

  _handleGetEnv: function (req, res) {
    if (cjConfig && typeof cjConfig.getEnvironmentInfo === 'function') {
      cjAutomate._sendJson(res, 200, cjConfig.getEnvironmentInfo())
    } else {
      cjAutomate._sendJson(res, 500, { error: 'Config module not available' })
    }
  },

  _handleSwitchEnv: function (res, body) {
    var envKey = body.environment || body.env
    if (!envKey) {
      return cjAutomate._sendJson(res, 400, { error: 'Missing field: environment (production|test|local)' })
    }
    if (cjConfig && typeof cjConfig.switchEnvironment === 'function') {
      var success = cjConfig.switchEnvironment(envKey)
      if (success) {
        cjAutomate._sendJson(res, 200, { success: true, environment: cjConfig.getEnvironmentInfo() })
      } else {
        cjAutomate._sendJson(res, 400, { error: 'Unknown environment: ' + envKey + '. Valid: production, test, local' })
      }
    } else {
      cjAutomate._sendJson(res, 500, { error: 'Config module not available' })
    }
  },

  // ---- Skills Manifest ----

  _getSkillsManifest: function () {
    return {
      name: 'CJBrowser Automation API',
      version: '1.6.0',
      description: 'HTTP API for AI agents to control CJBrowser — navigate pages, execute scripts, take screenshots, manage tabs, authentication, proxy status, environment switching.',
      baseUrl: 'http://127.0.0.1:' + cjAutomate.port,
      authentication: {
        type: 'bearer',
        description: 'Use Authorization: Bearer <token>. Supports WeChat token (default), static tokens, and popup authorization (60s temp token).',
        tokenSources: ['Enterprise WeChat login token (default)', 'CJ_AUTOMATE_TOKEN env var', 'cj-automate-tokens.json', 'POST /api/auth/request (popup, 60s)']
      },
      endpoints: [
        { method: 'GET', path: '/api/status', description: 'Browser status (includes login, proxy, environment). No auth required.' },
        { method: 'GET', path: '/api/version', description: 'Version check — current, latest, updateAvailable, downloadUrl. No auth required.' },
        { method: 'GET', path: '/api/skills', description: 'This manifest. No auth required.' },
        { method: 'POST', path: '/api/auth/request', description: 'Request popup authorization. Returns temp token (60s). Has 1-min cooldown. No auth required.' },
        { method: 'GET', path: '/api/auth/status', description: 'Auth status and methods. Requires auth.' },
        { method: 'POST', path: '/api/auth/login', description: 'Trigger login window. Requires auth.' },
        { method: 'POST', path: '/api/auth/logout', description: 'Logout and disable proxy. Requires auth.' },
        { method: 'GET', path: '/api/proxy/status', description: 'Proxy status (enabled, source, loggedIn). Requires auth.' },
        { method: 'POST', path: '/api/proxy/mode', description: 'Switch proxy mode. Body: {mode: "company"|"direct"}. Requires auth.' },
        { method: 'GET', path: '/api/env', description: 'Get current environment info. Requires auth.' },
        { method: 'POST', path: '/api/env', description: 'Switch environment. Body: {environment: "production"|"test"|"local"}. Requires auth.' },
        { method: 'GET', path: '/api/tabs', description: 'List all tabs.' },
        { method: 'POST', path: '/api/tabs', description: 'Create new tab. Body: {url}.' },
        { method: 'GET', path: '/api/tabs/:id', description: 'Get tab info.' },
        { method: 'DELETE', path: '/api/tabs/:id', description: 'Close tab.' },
        { method: 'POST', path: '/api/tabs/:id/navigate', description: 'Navigate tab. Body: {url}.' },
        { method: 'POST', path: '/api/tabs/:id/execute', description: 'Execute JS in tab. Body: {code}.' },
        { method: 'GET', path: '/api/tabs/:id/screenshot', description: 'Screenshot (PNG).' },
        { method: 'GET', path: '/api/tabs/:id/content', description: 'Get page HTML.' },
        { method: 'POST', path: '/api/tabs/:id/activate', description: 'Switch to tab.' },
        { method: 'POST', path: '/api/tabs/:id/control', description: 'Take automation control. Shows overlay, blocks user input. Body: {agent}.' },
        { method: 'DELETE', path: '/api/tabs/:id/control', description: 'Release automation control. Removes overlay.' }
      ]
    }
  },

  // ---- Shutdown ----

  shutdown: function () {
    var controlledIds = Object.keys(cjAutomate.controlledTabs)
    for (var i = 0; i < controlledIds.length; i++) {
      cjAutomate._releaseTabControl(controlledIds[i])
    }
    if (cjAutomate.server) {
      cjAutomate.server.close()
      console.log('[CJ Automate] Server stopped')
    }
  }
}
