/* CJ Browser - Enterprise WeChat (企业微信) Authentication */

/* electron modules: BrowserWindow, ipc, session, fs, path are available from main.js */

var cjAuth = {
  tokenFilePath: null,
  currentUser: null,
  token: null,

  initialize: function (userDataPath) {
    cjAuth.tokenFilePath = path.join(userDataPath, 'cj-auth.json')
    cjAuth.loadToken()

    // IPC handlers for renderer
    // Login: navigate to CJ AI login page so user can authenticate via enterprise WeChat
    ipc.on('cj-auth-login', function () {
      sendIPCToWindow(windows.getCurrent(), 'addTab', {
        url: cjConfig.getLoginUrl()
      })
    })

    ipc.on('cj-auth-logout', function () {
      cjAuth.logout()
    })

    ipc.on('cj-auth-getUser', function (e) {
      e.returnValue = cjAuth.currentUser
    })

    ipc.on('cj-auth-getToken', function (e) {
      e.returnValue = cjAuth.token
    })

    ipc.handle('cj-auth-status', function () {
      return {
        loggedIn: !!cjAuth.token,
        user: cjAuth.currentUser
      }
    })
  },

  loadToken: function () {
    try {
      if (fs.existsSync(cjAuth.tokenFilePath)) {
        var data = JSON.parse(fs.readFileSync(cjAuth.tokenFilePath, 'utf-8'))
        if (data.token && data.expiresAt && Date.now() < data.expiresAt) {
          cjAuth.token = data.token
          cjAuth.currentUser = data.user
          console.log('[CJ Auth] Token loaded for user:', cjAuth.currentUser ? cjAuth.currentUser.name : 'unknown')
        } else {
          console.log('[CJ Auth] Token expired, clearing')
          cjAuth.clearToken()
        }
      }
    } catch (e) {
      console.warn('[CJ Auth] Failed to load token:', e.message)
    }
  },

  saveToken: function (token, user, expiresIn) {
    cjAuth.token = token
    cjAuth.currentUser = user
    try {
      fs.writeFileSync(cjAuth.tokenFilePath, JSON.stringify({
        token: token,
        user: user,
        expiresAt: Date.now() + (expiresIn || 180 * 24 * 60 * 60 * 1000)
      }), 'utf-8')
    } catch (e) {
      console.warn('[CJ Auth] Failed to save token:', e.message)
    }
  },

  clearToken: function () {
    cjAuth.token = null
    cjAuth.currentUser = null
    try {
      if (fs.existsSync(cjAuth.tokenFilePath)) {
        fs.unlinkSync(cjAuth.tokenFilePath)
      }
    } catch (e) {
      // ignore
    }
  },

  validateToken: function (token) {
    var backendUrl = cjConfig.getBackendUrl()

    return new Promise(function (resolve) {
      var request = net.request({
        method: 'POST',
        url: backendUrl + '/api/browser/login'
      })

      request.setHeader('Content-Type', 'application/json')
      request.setHeader('Authorization', 'Bearer ' + token)

      var responseBody = ''
      request.on('response', function (response) {
        response.on('data', function (chunk) {
          responseBody += chunk.toString()
        })
        response.on('end', function () {
          try {
            var result = JSON.parse(responseBody)
            if (result.code === 200 && result.data) {
              resolve(result.data)
            } else {
              console.warn('[CJ Auth] Token validation failed:', result.message || 'unknown error')
              resolve(null)
            }
          } catch (e) {
            resolve(null)
          }
        })
      })

      request.on('error', function () {
        resolve(null)
      })

      request.write('{}')
      request.end()
    })
  },

  logout: function () {
    cjAuth.clearToken()
    // Clear session cookies
    session.defaultSession.clearStorageData({ storages: ['cookies'] })
    // Disable proxy on logout
    if (typeof cjConfig !== 'undefined') {
      cjConfig.proxy = null
    }
    if (typeof updateProxyFromConfig === 'function') {
      updateProxyFromConfig()
    }
    // Notify windows
    windows.getAll().forEach(function (win) {
      getWindowWebContents(win).send('cj-auth-changed', {
        loggedIn: false,
        user: null
      })
    })
    console.log('[CJ Auth] User logged out')
  },

  getToken: function () {
    return cjAuth.token
  },

  getUser: function () {
    return cjAuth.currentUser
  },

  isLoggedIn: function () {
    return !!cjAuth.token
  },

  /**
   * Auto-login detection: check cookies on CJ domains for ERP tokens
   * Called when a CJ domain page finishes loading.
   * When a valid token is found, login directly without user confirmation.
   */
  checkAutoLogin: function (url, webContents) {
    // Don't re-check if recently checked (cooldown 5s)
    if (cjAuth._lastAutoLoginCheck && Date.now() - cjAuth._lastAutoLoginCheck < 5000) {
      return
    }

    // Only check for cjdropshipping domains
    try {
      var urlObj = new URL(url)
      if (urlObj.hostname.indexOf('cjdropshipping') === -1) return
    } catch (e) {
      return
    }

    cjAuth._lastAutoLoginCheck = Date.now()

    // Step 1: Look for auth-like cookies on this domain
    session.defaultSession.cookies.get({ url: url }).then(function (cookies) {
      var tokenCookie = null
      var commonNames = ['ERP_TOKEN', 'token', 'access_token', 'Authorization', 'ERP_SID', 'JSESSIONID', 'sso_token', 'cj_token']

      for (var i = 0; i < cookies.length; i++) {
        for (var j = 0; j < commonNames.length; j++) {
          if (cookies[i].name.toLowerCase() === commonNames[j].toLowerCase() && cookies[i].value && cookies[i].value.length > 10) {
            tokenCookie = cookies[i]
            break
          }
        }
        if (tokenCookie) break
      }

      if (tokenCookie) {
        // Already logged in with same token, skip
        if (cjAuth.token === tokenCookie.value) return

        // Validate cookie token with backend; if fails, fallback to localStorage
        cjAuth.validateToken(tokenCookie.value).then(function (result) {
          if (result && result.token && result.user) {
            cjAuth._completeAutoLogin(result.token, result.user)
          } else if (webContents && !webContents.isDestroyed()) {
            // Cookie validation failed — try localStorage
            cjAuth._checkLocalStorageLogin(webContents)
          }
        })
        return
      }

      // Step 2: No cookie found — check localStorage for CJAI token
      if (webContents && !webContents.isDestroyed()) {
        cjAuth._checkLocalStorageLogin(webContents)
      }
    }).catch(function () {})
  },

  _checkLocalStorageLogin: function (webContents) {
    webContents.executeJavaScript(
      'JSON.stringify({t:localStorage.getItem("_TOKEN_"),u:localStorage.getItem("_USERINFO_")})'
    ).then(function (raw) {
      try {
        var data = JSON.parse(raw)
        if (!data.t || data.t.length < 10) return

        // Already logged in with same token
        if (cjAuth.token === data.t) return

        // Parse user info from localStorage
        var user = null
        try {
          var info = JSON.parse(data.u)
          user = {
            name: info.name || info.nameEn || info.number,
            id: info.userId || info.number,
            number: info.number,
            avatar: info.avatar,
            email: info.email
          }
        } catch (e) {
          user = { name: 'unknown', id: 'unknown' }
        }

        console.log('[CJ Auth] Found token in localStorage for:', user.name)
        cjAuth._completeAutoLogin(data.t, user)
      } catch (e) {
        // ignore parse errors
      }
    }).catch(function () {})
  },

  _completeAutoLogin: function (token, user) {
    var sameUser = cjAuth.currentUser && cjAuth.currentUser.name === user.name
    if (sameUser && cjAuth.token) return

    cjAuth.saveToken(token, user)

    // Notify all windows
    windows.getAll().forEach(function (win) {
      getWindowWebContents(win).send('cj-auth-changed', {
        loggedIn: true,
        user: user
      })
      getWindowWebContents(win).send('cj-auto-login-success', {
        username: user.name || user.id
      })
    })

    // Re-fetch config with new token (proxy, domains)
    cjConfig.fetchConfig(token).then(function () {
      windows.getAll().forEach(function (win) {
        getWindowWebContents(win).send('cj-domains-updated', cjConfig.getDomains())
      })
      return cjConfig.fetchPacDomains(token)
    }).then(function () {
      if (cjConfig && typeof cjConfig.startPacRefresh === 'function') {
        cjConfig.startPacRefresh()
      }
      if (typeof updateProxyFromConfig === 'function') {
        updateProxyFromConfig()
      }
      console.log('[CJ Auth] Post-login config refreshed, proxy applied')
    })

    console.log('[CJ Auth] Auto-login successful for:', user.name || 'unknown')
  },

  _lastAutoLoginCheck: 0
}
