/* CJ Browser - Proxy Configuration (代理配置) */

/* 全局变量 app, session, webContents 来自 main.js */
/* 全局变量 cjConfig 来自 cjConfig.js (构建文件拼接模式) */
/* 全局变量 settings 来自 settingsMain.js */

var cjProxyConfig = {}
var cjProxyCredentials = null
var cjProxyEnabled = false
var cjProxySource = 'none'
var cjProxyApplyToken = 0
var cjProxySyncChain = Promise.resolve()

function getUniqueSessions () {
  var sessions = []
  var seen = []

  webContents.getAllWebContents().forEach(function (wc) {
    if (wc.session && seen.indexOf(wc.session) === -1) {
      seen.push(wc.session)
      sessions.push(wc.session)
    }
  })

  if (session && session.defaultSession && seen.indexOf(session.defaultSession) === -1) {
    sessions.push(session.defaultSession)
  }

  return sessions
}

function syncProxyToSessions (config, token) {
  return Promise.all(getUniqueSessions().map(function (currentSession) {
    return currentSession.setProxy(config).then(function () {
      var syncTasks = []

      if (typeof currentSession.forceReloadProxyConfig === 'function') {
        syncTasks.push(currentSession.forceReloadProxyConfig().catch(function () {}))
      }

      if (token === cjProxyApplyToken && typeof currentSession.closeAllConnections === 'function') {
        syncTasks.push(currentSession.closeAllConnections().catch(function () {}))
      }

      return Promise.all(syncTasks)
    }).catch(function (err) {
      console.warn('[CJ Proxy] Failed to update session proxy:', err && err.message ? err.message : err)
    })
  }))
}

function queueProxySync (config, token) {
  cjProxySyncChain = cjProxySyncChain.catch(function () {}).then(function () {
    return syncProxyToSessions(config, token)
  })

  return cjProxySyncChain
}

function broadcastProxyStatus (enabled, source) {
  windows.getAll().forEach(function (win) {
    getWindowWebContents(win).send('cj-proxy-status', {
      enabled: enabled,
      source: source,
      loggedIn: !!(typeof cjAuth !== 'undefined' && cjAuth.getToken())
    })
  })
}

// Build PAC script from proxy config
// proxyDomains: array of domain patterns that should go through proxy
// proxyAddr: "host:port" string
// proxyType: "PROXY" (HTTP) or "HTTPS" (HTTPS proxy)
function buildCJPacScript (proxyAddr, proxyDomains, proxyType) {
  if (!proxyAddr || !proxyDomains || proxyDomains.length === 0) {
    return ''
  }
  var pType = proxyType || 'PROXY'
  // Convert domain patterns to PAC conditions
  // Supported patterns: "*.google.com", "youtube.com", "8.216.*"
  var conditions = []
  for (var i = 0; i < proxyDomains.length; i++) {
    var d = proxyDomains[i]
    if (d.indexOf('*') === 0) {
      // *.google.com → dnsDomainIs(host, ".google.com") || host == "google.com"
      var suffix = d.substring(1) // .google.com
      var bare = d.substring(2) // google.com
      conditions.push('dnsDomainIs(host, "' + suffix + '") || host == "' + bare + '"')
    } else {
      conditions.push('host == "' + d + '"')
    }
  }
  var pac = 'function FindProxyForURL(url, host) {\n'
  // Always bypass localhost / internal
  pac += '  if (host == "localhost" || host == "127.0.0.1" || isInNet(host, "10.0.0.0", "255.0.0.0") || isInNet(host, "172.16.0.0", "255.240.0.0") || isInNet(host, "192.168.0.0", "255.255.0.0")) return "DIRECT";\n'
  pac += '  if (' + conditions.join(' || ') + ') return "' + pType + ' ' + proxyAddr + '";\n'
  pac += '  return "DIRECT";\n'
  pac += '}'
  return pac
}

function applyCJProxy (proxyInfo, source) {
  var disableProxy = (proxyInfo === false)
  var p = (proxyInfo === false) ? null : (proxyInfo || (typeof cjConfig !== 'undefined' ? cjConfig.proxy : null))
  var token = ++cjProxyApplyToken

  if (!p || !p.host) {
    console.log('[CJ Proxy] No proxy config, using direct connection')
    cjProxyCredentials = null
    cjProxyEnabled = false
    cjProxySource = disableProxy ? 'direct' : 'none'
    cjProxyConfig = {}
    queueProxySync({ mode: 'direct' }, token)
    broadcastProxyStatus(false, cjProxySource)
    return
  }

  cjProxyCredentials = { username: p.username, password: p.password }
  cjProxyEnabled = true
  cjProxySource = source || 'company'

  var proxyAddr = p.host + ':' + p.port
  var proxyDomains = p.proxyDomains || []
  // Determine proxy type: HTTPS proxy or standard HTTP PROXY
  var proxyProtocol = (p.protocol && p.protocol.toLowerCase() === 'https') ? 'HTTPS' : 'PROXY'

  if (proxyDomains.length > 0) {
    // PAC mode: only proxy specified domains
    var pac = buildCJPacScript(proxyAddr, proxyDomains, proxyProtocol)
    cjProxyConfig = { pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64') }
    console.log('[CJ Proxy] Applied PAC-based ' + proxyProtocol + ' proxy for ' + proxyDomains.length + ' domain pattern(s) via ' + proxyAddr)
  } else {
    // Legacy mode: proxy all traffic, bypass CJ internal domains
    var bypassRules = [
      'localhost', '127.0.0.1',
      '*.cjdropshipping.com', '*.cjdropshipping.cn', '*.cj.com',
      '10.*', '172.16.*', '192.168.*'
    ].join(',')
    var proxyPrefix = (proxyProtocol === 'HTTPS') ? 'https://' : ''
    cjProxyConfig = {
      proxyRules: 'http=' + proxyPrefix + proxyAddr + ';https=' + proxyPrefix + proxyAddr,
      proxyBypassRules: bypassRules
    }
    console.log('[CJ Proxy] Applied global ' + proxyProtocol + ' proxy:', proxyAddr)
  }

  queueProxySync(cjProxyConfig, token)
  broadcastProxyStatus(true, cjProxySource)
}

// Handle proxy authentication — always prevent system login popup
app.on('login', function (event, wc, authenticationResponseDetails, authInfo, callback) {
  if (authInfo.isProxy) {
    event.preventDefault()
    if (cjProxyCredentials) {
      callback(cjProxyCredentials.username, cjProxyCredentials.password)
    } else {
      callback()
    }
  }
})

// On startup: do NOT apply proxy (wait for backend config)
app.on('ready', function () {
  console.log('[CJ Proxy] Waiting for backend config before applying proxy')
})

// Called by main.js after backend config is fetched
function updateProxyFromConfig () {
  if (typeof cjConfig !== 'undefined' && cjConfig.proxy) {
    var proxyConf = cjConfig.proxy
    // Merge PAC domains if backend proxy config doesn't include proxyDomains
    if ((!proxyConf.proxyDomains || proxyConf.proxyDomains.length === 0) && cjConfig.pacDomains && cjConfig.pacDomains.length > 0) {
      proxyConf = {
        protocol: proxyConf.protocol,
        host: proxyConf.host,
        port: proxyConf.port,
        username: proxyConf.username,
        password: proxyConf.password,
        proxyDomains: cjConfig.pacDomains
      }
    }
    applyCJProxy(proxyConf, 'company')
  } else {
    console.log('[CJ Proxy] No proxy config from backend, using direct connection')
    applyCJProxy(false, 'none')
  }
}

// Also respect user manual proxy settings from Min's settings panel
settings.listen('proxy', function (proxy) {
  proxy = proxy || {}
  switch (proxy.type) {
    case 1:
      cjProxyConfig = {
        proxyRules: proxy.proxyRules,
        proxyBypassRules: proxy.proxyBypassRules || ''
      }
      break
    case 2:
      cjProxyConfig = { pacScript: proxy.pacScript }
      break
    default:
      if (cjProxyEnabled) {
        applyCJProxy()
      }
      return
  }
  queueProxySync(cjProxyConfig, ++cjProxyApplyToken)
})

app.on('session-created', function (s) {
  if (cjProxyEnabled) {
    var token = cjProxyApplyToken

    s.setProxy(cjProxyConfig).then(function () {
      var syncTasks = []

      if (typeof s.forceReloadProxyConfig === 'function') {
        syncTasks.push(s.forceReloadProxyConfig().catch(function () {}))
      }

      if (token === cjProxyApplyToken && typeof s.closeAllConnections === 'function') {
        syncTasks.push(s.closeAllConnections().catch(function () {}))
      }

      return Promise.all(syncTasks)
    }).catch(function () {})
  }
})
