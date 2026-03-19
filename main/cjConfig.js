/* CJ Browser - Backend Config Fetcher (多环境支持) */

/* electron modules: net, app are available from main.js */

var CJ_ENVIRONMENTS = {
  production: {
    name: '线上环境',
    backendUrl: 'https://cjai.cjdropshipping.cn/cj-openai-chat-web',
    loginUrl: 'https://cjai.cjdropshipping.cn/',
    label: '线上'
  },
  test: {
    name: '测试环境',
    backendUrl: 'https://cjai-test.cjdropshipping.cn/cj-openai-chat-web',
    loginUrl: 'https://cjai-test.cjdropshipping.cn/',
    label: '测试'
  },
  local: {
    name: '本机调试',
    backendUrl: 'http://localhost:9991/cj-openai-chat-web',
    loginUrl: 'https://cjai.cjdropshipping.cn/',
    label: '本机'
  }
}

var CJ_PAC_REFRESH_INTERVAL_MS = 5 * 60 * 1000
var CJ_TIMEOUT_ERROR_CODE = -118

function cjUniqueDomains (domains) {
  var unique = []
  ;(domains || []).forEach(function (domain) {
    if (unique.indexOf(domain) === -1) {
      unique.push(domain)
    }
  })
  return unique
}

function cjNormalizeHost (value) {
  if (!value) {
    return ''
  }

  var host = value
  try {
    if (value.indexOf('://') !== -1) {
      host = new URL(value).hostname || ''
    }
  } catch (e) {}

  host = String(host).toLowerCase().trim()
  host = host.replace(/^\*\./, '')
  host = host.replace(/:\d+$/, '')
  return host
}

function cjDomainMatchesHost (pattern, host) {
  if (!pattern || !host) {
    return false
  }

  var normalizedPattern = cjNormalizeHost(pattern)
  if (!normalizedPattern) {
    return false
  }

  if (normalizedPattern === host) {
    return true
  }

  if (pattern.indexOf('*.') === 0) {
    return host === normalizedPattern || host.slice(-(normalizedPattern.length + 1)) === '.' + normalizedPattern
  }

  if (pattern.indexOf('*') !== -1) {
    var escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    return new RegExp('^' + escaped + '$', 'i').test(host)
  }

  return host === normalizedPattern
}

var cjConfig = {
  currentEnv: 'production',
  domains: [],
  proxy: null,
  pacDomains: [],
  pacRefreshIntervalMs: CJ_PAC_REFRESH_INTERVAL_MS,
  pacRefreshTimer: null,
  lastPacFetchAt: 0,
  pendingPacPrompts: {},
  version: {
    latest: '1.0.5',
    forceUpdate: false,
    downloadUrl: '',
    releaseNotes: ''
  },
  loaded: false,

  /**
   * Initialize environment based on startup arguments
   * --development-mode → local, otherwise check saved preference or default to production
   */
  initializeEnv: function () {
    var isDev = process.argv.some(function (arg) { return arg === '--development-mode' })
    if (isDev) {
      cjConfig.currentEnv = 'local'
    } else {
      // Load saved environment preference
      try {
        var savedEnv = settings.get('cjEnvironment')
        if (savedEnv && CJ_ENVIRONMENTS[savedEnv]) {
          cjConfig.currentEnv = savedEnv
        }
      } catch (e) {}
    }
    console.log('[CJ Config] Environment: ' + cjConfig.currentEnv + ' (' + CJ_ENVIRONMENTS[cjConfig.currentEnv].name + ')')
  },

  getBackendUrl: function () {
    return CJ_ENVIRONMENTS[cjConfig.currentEnv].backendUrl
  },

  getLoginUrl: function () {
    return CJ_ENVIRONMENTS[cjConfig.currentEnv].loginUrl
  },

  getEnvironment: function () {
    return cjConfig.currentEnv
  },

  getEnvironmentInfo: function () {
    return {
      current: cjConfig.currentEnv,
      name: CJ_ENVIRONMENTS[cjConfig.currentEnv].name,
      label: CJ_ENVIRONMENTS[cjConfig.currentEnv].label,
      backendUrl: CJ_ENVIRONMENTS[cjConfig.currentEnv].backendUrl,
      available: Object.keys(CJ_ENVIRONMENTS).map(function (key) {
        return { key: key, name: CJ_ENVIRONMENTS[key].name, label: CJ_ENVIRONMENTS[key].label }
      })
    }
  },

  switchEnvironment: function (envKey) {
    if (!CJ_ENVIRONMENTS[envKey]) {
      return false
    }
    cjConfig.currentEnv = envKey
    settings.set('cjEnvironment', envKey)
    console.log('[CJ Config] Switched to: ' + envKey + ' (' + CJ_ENVIRONMENTS[envKey].name + ')')

    // Notify all windows
    windows.getAll().forEach(function (win) {
      getWindowWebContents(win).send('cj-env-changed', cjConfig.getEnvironmentInfo())
    })

    // Re-fetch config + PAC + proxy for new environment
    var token = (typeof cjAuth !== 'undefined') ? cjAuth.getToken() : null
    cjConfig.fetchConfig(token).then(function () {
      windows.getAll().forEach(function (win) {
        getWindowWebContents(win).send('cj-domains-updated', cjConfig.getDomains())
      })
      return cjConfig.fetchPacDomains(token)
    }).then(function () {
      cjConfig.startPacRefresh()
      if (typeof updateProxyFromConfig === 'function') {
        updateProxyFromConfig()
      }
      console.log('[CJ Config] Post-switch config refreshed')
    })

    return true
  },

  /**
   * Fetch config from backend, fallback to defaults
   */
  fetchConfig: function (token) {
    var backendUrl = cjConfig.getBackendUrl()
    return new Promise(function (resolve) {
      try {
        var url = backendUrl + '/api/browser/config'
        var request = net.request({
          method: 'GET',
          url: url
        })

        if (token) {
          request.setHeader('token', token)
        }

        var responseBody = ''

        request.on('response', function (response) {
          response.on('data', function (chunk) {
            responseBody += chunk.toString()
          })
          response.on('end', function () {
            try {
              var result = JSON.parse(responseBody)
              if (result.code === 200 && result.data) {
                if (result.data.domains && result.data.domains.length > 0) {
                  cjConfig.domains = result.data.domains
                }
                if (result.data.proxy) {
                  cjConfig.proxy = result.data.proxy
                }
                if (result.data.version) {
                  cjConfig.version = result.data.version
                }
                cjConfig.loaded = true
                console.log('[CJ Config] Loaded from backend (' + cjConfig.currentEnv + ')')
              }
            } catch (e) {
              console.warn('[CJ Config] Parse error, using defaults:', e.message)
            }
            resolve(cjConfig)
          })
        })

        request.on('error', function (err) {
          console.warn('[CJ Config] Backend unavailable:', err.message)
          resolve(cjConfig)
        })

        request.end()
      } catch (e) {
        console.warn('[CJ Config] Request error, using defaults:', e.message)
        resolve(cjConfig)
      }
    })
  },

  fetchPacDomains: function (token) {
    var backendUrl = cjConfig.getBackendUrl()
    return new Promise(function (resolve) {
      if (!token) {
        resolve([])
        return
      }
      try {
        var request = net.request({
          method: 'GET',
          url: backendUrl + '/api/browser/pac'
        })
        request.setHeader('token', token)

        var body = ''
        request.on('response', function (response) {
          response.on('data', function (chunk) { body += chunk.toString() })
          response.on('end', function () {
            try {
              var result = JSON.parse(body)
              if (result.code === 200 && result.data && result.data.domains) {
                cjConfig.pacDomains = cjUniqueDomains(result.data.domains)
                console.log('[CJ Config] PAC domains loaded: ' + result.data.domains.length + ' rules')
              } else if (result.code === 200) {
                cjConfig.pacDomains = []
              }
            } catch (e) {
              console.warn('[CJ Config] PAC parse error:', e.message)
            }
            cjConfig.lastPacFetchAt = Date.now()
            if (typeof cjProxyEnabled !== 'undefined' && cjProxyEnabled && typeof cjProxySource !== 'undefined' && cjProxySource !== 'direct' && typeof updateProxyFromConfig === 'function') {
              updateProxyFromConfig()
            }
            resolve(cjConfig.pacDomains)
          })
        })
        request.on('error', function (err) {
          console.warn('[CJ Config] PAC fetch error:', err.message)
          resolve([])
        })
        request.end()
      } catch (e) {
        resolve([])
      }
    })
  },

  getPacDomains: function () {
    return cjConfig.pacDomains
  },

  startPacRefresh: function () {
    if (cjConfig.pacRefreshTimer) {
      clearInterval(cjConfig.pacRefreshTimer)
    }

    cjConfig.pacRefreshTimer = setInterval(function () {
      var token = (typeof cjAuth !== 'undefined') ? cjAuth.getToken() : null
      if (!token) {
        return
      }
      cjConfig.fetchPacDomains(token)
    }, cjConfig.pacRefreshIntervalMs)

    console.log('[CJ Config] PAC auto-refresh every ' + Math.round(cjConfig.pacRefreshIntervalMs / 60000) + ' minutes')
  },

  matchesPacDomain: function (host) {
    var normalizedHost = cjNormalizeHost(host)
    var rules = cjUniqueDomains((cjConfig.pacDomains || []).concat((cjConfig.proxy && cjConfig.proxy.proxyDomains) || []))

    return rules.some(function (rule) {
      return cjDomainMatchesHost(rule, normalizedHost)
    })
  },

  buildProxyDomains: function (extraHost) {
    var domains = []
    if (cjConfig.proxy && cjConfig.proxy.proxyDomains && cjConfig.proxy.proxyDomains.length > 0) {
      domains = domains.concat(cjConfig.proxy.proxyDomains)
    }
    if (cjConfig.pacDomains && cjConfig.pacDomains.length > 0) {
      domains = domains.concat(cjConfig.pacDomains)
    }
    if (extraHost) {
      domains.push(cjNormalizeHost(extraHost))
    }
    return cjUniqueDomains(domains.filter(Boolean))
  },

  submitPacDomains: function (domains, token, metadata) {
    var backendUrl = cjConfig.getBackendUrl()

    return new Promise(function (resolve) {
      if (!token) {
        resolve({ submitted: false, reason: 'missing-token' })
        return
      }

      try {
        var request = net.request({
          method: 'POST',
          url: backendUrl + '/api/browser/pac'
        })
        var body = JSON.stringify({
          domains: domains,
          domain: metadata && metadata.domain,
          source: metadata && metadata.source,
          url: metadata && metadata.url
        })

        request.setHeader('Content-Type', 'application/json')
        request.setHeader('token', token)

        var responseBody = ''
        request.on('response', function (response) {
          response.on('data', function (chunk) {
            responseBody += chunk.toString()
          })
          response.on('end', function () {
            try {
              var result = responseBody ? JSON.parse(responseBody) : null
              if (response.statusCode >= 200 && response.statusCode < 300 && (!result || result.code === 200)) {
                resolve({ submitted: true })
                return
              }
            } catch (e) {}
            console.warn('[CJ Config] PAC submit not accepted by backend, keeping local rules only')
            resolve({ submitted: false, reason: 'backend-rejected' })
          })
        })
        request.on('error', function (err) {
          console.warn('[CJ Config] PAC submit failed:', err.message)
          resolve({ submitted: false, reason: err.message })
        })
        request.write(body)
        request.end()
      } catch (e) {
        console.warn('[CJ Config] PAC submit error:', e.message)
        resolve({ submitted: false, reason: e.message })
      }
    })
  },

  addPacDomain: function (domain, token, options) {
    var normalizedHost = cjNormalizeHost(domain)
    var updatedDomains = cjConfig.buildProxyDomains(normalizedHost)
    var alreadyExists = cjConfig.matchesPacDomain(normalizedHost)

    cjConfig.pacDomains = updatedDomains

    if (typeof cjProxyEnabled !== 'undefined' && cjProxyEnabled && typeof cjProxySource !== 'undefined' && cjProxySource !== 'direct' && typeof updateProxyFromConfig === 'function') {
      updateProxyFromConfig()
    }

    if (alreadyExists) {
      return Promise.resolve({ added: false, submitted: false })
    }

    if (options && options.submit === false) {
      return Promise.resolve({ added: true, submitted: false })
    }

    return cjConfig.submitPacDomains(updatedDomains, token, {
      domain: normalizedHost,
      source: options && options.source ? options.source : 'browser',
      url: options && options.url ? options.url : ''
    }).then(function (result) {
      return {
        added: true,
        submitted: !!result.submitted,
        reason: result.reason || ''
      }
    })
  },

  handleLoadFailure: function (payload) {
    if (!payload || payload.errorCode !== CJ_TIMEOUT_ERROR_CODE || !payload.validatedURL) {
      return Promise.resolve({ handled: false })
    }

    var host = cjNormalizeHost(payload.validatedURL)
    if (!host || !cjConfig.proxy || !cjConfig.proxy.host || typeof applyCJProxy !== 'function') {
      return Promise.resolve({ handled: false })
    }

    var token = (typeof cjAuth !== 'undefined') ? cjAuth.getToken() : null

    return cjConfig.fetchPacDomains(token).catch(function () {
      return cjConfig.pacDomains
    }).then(function () {
      if (cjConfig.matchesPacDomain(host)) {
        if (typeof updateProxyFromConfig === 'function') {
          updateProxyFromConfig()
        }
        cjConfig.pendingPacPrompts[host] = {
          host: host,
          url: payload.validatedURL,
          createdAt: Date.now(),
          needsPrompt: false
        }
        return {
          handled: true,
          reload: true,
          delayMs: 600,
          host: host,
          mode: 'company'
        }
      }

      applyCJProxy({
        protocol: cjConfig.proxy.protocol,
        host: cjConfig.proxy.host,
        port: cjConfig.proxy.port,
        username: cjConfig.proxy.username,
        password: cjConfig.proxy.password,
        proxyDomains: cjConfig.buildProxyDomains(host)
      }, 'timeout-probe')

      cjConfig.pendingPacPrompts[host] = {
        host: host,
        url: payload.validatedURL,
        createdAt: Date.now(),
        needsPrompt: true
      }

      return {
        handled: true,
        reload: true,
        delayMs: 900,
        host: host,
        mode: 'timeout-probe'
      }
    }).catch(function (err) {
      console.warn('[CJ Config] Timeout recovery failed:', err.message)
      return { handled: false, reason: err.message }
    })
  },

  handleRecoveredPage: function (url, targetWebContents) {
    var host = cjNormalizeHost(url)
    var pending = cjConfig.pendingPacPrompts[host]

    if (!pending || Date.now() - pending.createdAt > 2 * 60 * 1000) {
      delete cjConfig.pendingPacPrompts[host]
      return
    }

    delete cjConfig.pendingPacPrompts[host]

    if (!pending.needsPrompt) {
      return
    }

    dialog.showMessageBox(windows.getCurrent(), {
      type: 'question',
      buttons: ['添加到PAC并重新访问', '稍后再说'],
      defaultId: 0,
      cancelId: 1,
      title: 'CJ Browser',
      message: '检测到公司代理可访问该域名',
      detail: '域名 ' + host + ' 当前可通过公司代理访问。是否将其添加到 PAC 列表并提交到服务器，然后重新访问当前页面？'
    }).then(function (result) {
      if (result.response !== 0) {
        return
      }

      cjConfig.addPacDomain(host, (typeof cjAuth !== 'undefined') ? cjAuth.getToken() : null, {
        submit: true,
        source: 'timeout-recovery',
        url: url
      }).then(function () {
        if (typeof updateProxyFromConfig === 'function') {
          updateProxyFromConfig()
        }
        if (targetWebContents && !targetWebContents.isDestroyed()) {
          targetWebContents.loadURL(url).catch(function (err) {
            console.warn('[CJ Config] Reload after PAC update failed:', err.message)
          })
        }
      })
    }).catch(function (err) {
      console.warn('[CJ Config] PAC prompt failed:', err.message)
    })
  },

  getPacRefreshInfo: function () {
    return {
      intervalMs: cjConfig.pacRefreshIntervalMs,
      lastFetchAt: cjConfig.lastPacFetchAt
    }
  },

  getDomains: function () {
    return cjConfig.domains
  },

  getProxy: function () {
    return cjConfig.proxy
  },

  getVersion: function () {
    return cjConfig.version
  }
}

module.exports = cjConfig
