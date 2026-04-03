var viewMap = {} // id: view
var viewStateMap = {} // id: view state

var temporaryPopupViews = {} // id: view

// rate limit on "open in app" requests
var globalLaunchRequests = 0

function getDefaultViewWebPreferences () {
  return (
    {
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      scrollBounce: true,
      safeDialogs: true,
      safeDialogsMessage: 'Prevent this page from creating additional dialogs',
      preload: __dirname + '/dist/preload.js',
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
      allowPopups: false,
      // partition: partition || 'persist:webcontent',
      enableWebSQL: false,
      autoplayPolicy: (settings.get('enableAutoplay') ? 'no-user-gesture-required' : 'user-gesture-required'),
      // match Chrome's default for anti-fingerprinting purposes (Electron defaults to 0)
      minimumFontSize: 6,
      javascript: !(settings.get('filtering')?.contentTypes?.includes('script'))
    }
  )
}

function createView (existingViewId, id, webPreferences, boundsString, events) {
  if (viewStateMap[id]) {
    console.warn("Creating duplicate view")
  }

  const viewPrefs = Object.assign({}, getDefaultViewWebPreferences(), webPreferences)

  viewStateMap[id] = {
    loadedInitialURL: false,
    hasJS: viewPrefs.javascript, // need this later to see if we should swap the view for a JS-enabled one
    creationOptions: {
      boundsString: boundsString,
      events: (events || []).slice(),
      webPreferences: Object.assign({}, viewPrefs)
    }
  }

  let view
  if (existingViewId) {
    view = temporaryPopupViews[existingViewId]
    delete temporaryPopupViews[existingViewId]

    // the initial URL has already been loaded, so set the background color
    view.setBackgroundColor('#fff')
    viewStateMap[id].loadedInitialURL = true
  } else {
    view = new WebContentsView({ webPreferences: viewPrefs })
  }

  events.forEach(function (event) {
    view.webContents.on(event, function (e) {
      var args = Array.prototype.slice.call(arguments).slice(1)

      const eventTarget = getWindowFromViewContents(view.webContents) || windows.getCurrent()

      if (!eventTarget) {
        //this can happen during shutdown - windows can be destroyed before the corresponding views, and the view can emit an event during that time
        return
      }

      getWindowWebContents(eventTarget).send('view-event', {
        tabId: id,
        event: event,
        args: args
      })
    })
  })

  view.webContents.on('select-bluetooth-device', function (event, deviceList, callback) {
    event.preventDefault()
    callback('')
  })

  view.webContents.setWindowOpenHandler(function (details) {
    if (details.url && !filterPopups(details.url)) {
      return {
        action: 'deny'
      }
    }

    /*
      Opening a popup with window.open() generally requires features to be set
      So if there are no features, the event is most likely from clicking on a link, which should open a new tab.
      Clicking a link can still have a "new-window" or "foreground-tab" disposition depending on which keys are pressed
      when it is clicked.
      (https://github.com/minbrowser/min/issues/1835)
    */
    if (details.url && details.url !== 'about:blank' && !details.features) {
      const eventTarget = getWindowFromViewContents(view.webContents) || windows.getCurrent()

      getWindowWebContents(eventTarget).send('view-event', {
        tabId: id,
        event: 'new-tab',
        args: [details.url, !(details.disposition === 'background-tab')]
      })
      return {
        action: 'deny'
      }
    }

    return {
      action: 'allow',
      createWindow: function (options) {
        const view = new WebContentsView({ webPreferences: getDefaultViewWebPreferences(), webContents: options.webContents })

        var popupId = Math.random().toString()
        temporaryPopupViews[popupId] = view

        const eventTarget = getWindowFromViewContents(view.webContents) || windows.getCurrent()

        getWindowWebContents(eventTarget).send('view-event', {
          tabId: id,
          event: 'did-create-popup',
          args: [popupId, details.url]
        })

        return view.webContents
      }
    }
  })

  view.webContents.on('ipc-message', function (e, channel, data) {
    var senderURL
    try {
      senderURL = e.senderFrame.url
    } catch (err) {
      // https://github.com/minbrowser/min/issues/2052
      console.warn('dropping message because senderFrame is destroyed', channel, data, err)
      return
    }

    const eventTarget = getWindowFromViewContents(view.webContents) || windows.getCurrent()

    if (!eventTarget) {
      //this can happen during shutdown - windows can be destroyed before the corresponding views, and the view can emit an event during that time
      return
    }

    getWindowWebContents(eventTarget).send('view-ipc', {
      id: id,
      name: channel,
      data: data,
      frameId: e.frameId,
      frameURL: senderURL
    })
  })

  // Open a login prompt when site asks for http authentication
  view.webContents.on('login', (event, authenticationResponseDetails, authInfo, callback) => {
    if (authInfo.isProxy) { // Proxy auth handled by app-level handler in proxy.js
      return
    }
    if (authInfo.scheme !== 'basic') { // Only for basic auth
      return
    }
    event.preventDefault()
    var title = l('loginPromptTitle').replace('%h', authInfo.host)
    createPrompt({
      text: title,
      values: [{ placeholder: l('username'), id: 'username', type: 'text' },
        { placeholder: l('password'), id: 'password', type: 'password' }],
      ok: l('dialogConfirmButton'),
      cancel: l('dialogSkipButton'),
      width: 400,
      height: 200
    }, function (result) {
      // resend request with auth credentials
      callback(result.username, result.password)
    })
  })

  // show an "open in app" prompt for external protocols

  function handleExternalProtocol (e, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) {
    var knownProtocols = ['http', 'https', 'file', 'min', 'about', 'data', 'javascript', 'chrome'] // flash[26年03月14日15:38] 已支持的协议列表，覆盖常见场景
    if (!knownProtocols.includes(url.split(':')[0])) {
      var externalApp = app.getApplicationNameForProtocol(url)
      if (externalApp) {
        var sanitizedName = externalApp.replace(/[^a-zA-Z0-9.]/g, '')
        if (globalLaunchRequests < 2) {
          globalLaunchRequests++
          setTimeout(function () {
            globalLaunchRequests--
          }, 20000)
          electron.dialog.showMessageBox({
            type: 'question',
            buttons: ['OK', 'Cancel'],
            message: l('openExternalApp').replace('%s', sanitizedName).replace(/\\/g, ''),
            detail: url.length > 160 ? url.substring(0, 160) + '...' : url
          }).then(function (result) {
            if (result.response === 0) {
              electron.shell.openExternal(url)
            }
          })
        }
      }
    }
  }

  view.webContents.on('did-start-navigation', handleExternalProtocol)

  // CJ Browser: Collect console messages into in-memory ring buffer
  view.webContents.on('console-message', function (event, level, message, line, sourceId) {
    if (typeof cjAutomate !== 'undefined' && cjAutomate.appendTabLog) {
      var levelNames = ['verbose', 'info', 'warning', 'error']
      cjAutomate.appendTabLog(id, levelNames[level] || 'log', message, sourceId, line)
    }
  })

  // CJ Browser: Track page navigation for operation logging
  /**
   * @correction #2108#8 did-start-navigation和did-finish-load事件都写入ring buffer，
   * 记录每次页面跳转的URL，日志驻留在主进程不随页面销毁丢失。
   */
  view.webContents.on('did-start-navigation', function (event, url, isInPlace, isMainFrame) {
    if (isMainFrame && typeof cjAutomate !== 'undefined' && cjAutomate.appendTabLog) {
      cjAutomate.appendTabLog(id, 'navigate', '[NAV-START] ' + (url || ''))
    }
  })

  view.webContents.on('did-finish-load', function () {
    try {
      var url = view.webContents.getURL()
      var title = view.webContents.getTitle()
      // @correction #2108#8 页面加载完成写入ring buffer
      if (typeof cjAutomate !== 'undefined' && cjAutomate.appendTabLog) {
        cjAutomate.appendTabLog(id, 'load', '[NAV-LOADED] ' + (url || '') + ' title=' + (title || ''))
      }
      if (url && !url.startsWith('min://') && url !== 'about:blank') {
        cjTracker.trackPageView(url, title, id)
        // @since #1331#2 环境同步: 检测第三方服务导航
        if (typeof cjEnvSync !== 'undefined' && cjEnvSync.onPageNavigate) {
          cjEnvSync.onPageNavigate(url)
        }
        // CJ Browser: Check for auto-login on CJ domains and localhost (development mode)
        /**
         * @correction #0403#4 触发条件扩展: 增加 localhost/127.0.0.1 以修复本地开发模式
         * 下 checkAutoLogin 不触发的问题。此前仅匹配 cjdropshipping 域名。
         */
        var isCjUrl = url.indexOf('cjdropshipping') !== -1
        var isLocalUrl = url.indexOf('localhost') !== -1 || url.indexOf('127.0.0.1') !== -1
        if ((isCjUrl || isLocalUrl) && cjAuth && typeof cjAuth.checkAutoLogin === 'function') {
          cjAuth.checkAutoLogin(url, view.webContents)
        }
        if (cjConfig && typeof cjConfig.handleRecoveredPage === 'function') {
          cjConfig.handleRecoveredPage(url, view.webContents)
        }
        /**
         * CF Turnstile 自动检测与跳过 — 浏览器基础可复用能力
         * @correction 1549补充#6 CF跳过作为基础能力，页面加载时自动检测并触发bypass
         *             在非录制/回放模式下仅检测并记录，在自动化上下文中自动触发bypass
         * @correction #1556#6 跳过localhost/内部页面减少CDP调用降低CPU占用
         * @correction #2312#3 手动浏览时仅检测记录，不触发bypass；只有在自动化上下文
         *             (录制/回放/受控tab)时才自动触发bypass，防止手动访问CF站点时浏览器卡死
         */
        if (typeof cjAutomationAssistant !== 'undefined' && cjAutomationAssistant._isCfBlocked
            && url.indexOf('localhost') === -1 && url.indexOf('127.0.0.1') === -1 && !url.startsWith('min://')) {
          cjAutomationAssistant._isCfBlocked(view.webContents).then(function (blocked) {
            if (blocked) {
              console.log('[CJ View] Cloudflare Turnstile detected on ' + url.substring(0, 80) + ' (tab ' + id + ')')
              // @correction #2312#3: Only auto-trigger bypass in automation context
              // Manual browsing: detect + log only, no OS-level intervention
              var isAutomationCtx = false
              if (typeof cjAutomationAssistant._findActiveTaskByTab === 'function' && cjAutomationAssistant._findActiveTaskByTab(id)) {
                isAutomationCtx = true
              }
              if (!isAutomationCtx && typeof cjAutomate !== 'undefined' && cjAutomate.controlledTabs && cjAutomate.controlledTabs[id]) {
                isAutomationCtx = true
              }
              /**
               * @correction 260403 macOS复核: CF弹出窗口的tab也需要自动bypass。
               * 弹出窗口由_handleCfBypass创建，其tab不在controlledTabs中，
               * 但如果_cfPopupWin存在且包含该view，则视为自动化上下文。
               */
              if (!isAutomationCtx && typeof cjAutomate !== 'undefined' && cjAutomate._cfPopupWin && !cjAutomate._cfPopupWin.isDestroyed()) {
                var popWin = cjAutomate._cfPopupWin
                try {
                  var viewWin = view && view.webContents ? (typeof getWindowFromViewContents === 'function' ? getWindowFromViewContents(view.webContents) : null) : null
                  if (viewWin && viewWin === popWin) {
                    isAutomationCtx = true
                    console.log('[CJ View] CF popup window tab detected, enabling auto-bypass (tab ' + id + ')')
                  }
                } catch (e) {}
              }
              if (isAutomationCtx && typeof cjAutomationAssistant._onCfDetected === 'function') {
                cjAutomationAssistant._onCfDetected(id, view.webContents, url)
              } else {
                console.log('[CJ View] CF detected but tab not in automation context, skipping auto-bypass (tab ' + id + ')')
              }
            }
          }).catch(function () {})
        }
      }
    } catch (e) {
      console.warn('[CJ View] did-finish-load error:', e.message)
    }
  })

  /**
   * @correction #2304#9 CDP永不释放 — 浏览器启动时即加载CDP
   * 每个view创建后立即attach CDP debugger，确保CDP始终可用。
   * 如需修改此方案，请与项目负责人确认。
   */
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3')
      console.log('[CJ View] CDP auto-attached for tab ' + id + ' (per #2304#9 policy)')
    }
  } catch (cdpErr) {
    console.warn('[CJ View] CDP auto-attach failed for tab ' + id + ': ' + cdpErr.message)
  }

  /*
  It's possible for an HTTP request to redirect to an external app link
  (primary use case for this is OAuth from desktop app > browser > back to app)
  and did-start-navigation isn't (always?) emitted for redirects, so we need this handler as well
  */
  view.webContents.on('will-redirect', handleExternalProtocol)

  /*
  the JS setting can only be set when the view is created, so swap the view on navigation if the setting value changed
  This can occur if the user manually changed the setting, or if we are navigating between an internal page (always gets JS)
  and an external one
  */
  view.webContents.on('did-start-navigation', function (event) {
    if (event.isMainFrame && !event.isSameDocument) {
      const hasJS = viewStateMap[id].hasJS
      const shouldHaveJS = (!(settings.get('filtering')?.contentTypes?.includes('script'))) || event.url.startsWith('min://')
      if (hasJS !== shouldHaveJS) {
        setTimeout(function () {
          view.webContents.stop()
          const currentWindow = getWindowFromViewContents(view.webContents)
          destroyView(id)
          const newView = createView(existingViewId, id, Object.assign({}, webPreferences, { javascript: shouldHaveJS }), boundsString, events)
          loadURLInView(id, event.url, currentWindow)

          if (currentWindow) {
            setView(id, getWindowWebContents(currentWindow))
            focusView(id)
          }
        }, 0)
      }
    }
  })

  view.setBounds(JSON.parse(boundsString))

  viewMap[id] = view

  return view
}

function destroyView (id) {
  if (!viewMap[id]) {
    return
  }

  windows.getAll().forEach(function (window) {
    if (windows.getState(window).selectedView === id) {
      window.getContentView().removeChildView(viewMap[id])
      windows.getState(window).selectedView = null
    }
  })
  viewMap[id].webContents.destroy()

  delete viewMap[id]
  delete viewStateMap[id]
}

function destroyAllViews () {
  for (const id in viewMap) {
    destroyView(id)
  }
}

function setView (id, senderContents) {
  const win = windows.windowFromContents(senderContents).win

  // changing views can cause flickering, so we only want to call it if the view is actually changing
  // see https://github.com/minbrowser/min/issues/1966
  // @correction #1556#7#8 修复比较: selectedView存储id(string), 应与id比较而非viewMap[id](object)
  if (windows.getState(win).selectedView !== id) {
    //remove all prior views
    win.getContentView().children.slice(1).forEach(child => win.getContentView().removeChildView(child))
    if (viewStateMap[id].loadedInitialURL) {
      win.getContentView().addChildView(viewMap[id])
    } else {
      win.getContentView().removeChildView(viewMap[id])
    }
    windows.getState(win).selectedView = id
  }
}

function setBounds (id, bounds) {
  if (viewMap[id]) {
    /**
     * @correction 第24次提交: CF新窗口方案不再移动view，无需拦截setBounds。
     */
    viewMap[id].setBounds(bounds)
  }
}

function focusView (id) {
  // empty views can't be focused because they won't propogate keyboard events correctly, see https://github.com/minbrowser/min/issues/616
  // also, make sure the view exists, since it might not if the app is shutting down
  if (viewMap[id] && (viewMap[id].webContents.getURL() !== '' || viewMap[id].webContents.isLoading())) {
    viewMap[id].webContents.focus()
    return true
  } else if (getWindowFromViewContents(viewMap[id]?.webContents)) {
    getWindowWebContents(getWindowFromViewContents(viewMap[id]?.webContents)).focus()
    return true
  }
}

function hideCurrentView (senderContents) {
  const win = windows.windowFromContents(senderContents).win
  const currentId = windows.getState(win).selectedView
  if (currentId) {
    win.getContentView().removeChildView(viewMap[currentId])
    windows.getState(win).selectedView = null
    if (win.isFocused()) {
      getWindowWebContents(win).focus()
    }
  }
}

function getView (id) {
  return viewMap[id]
}

function recreateViewWithWebPreferences (id, webPreferences, url, win) {
  if (!viewMap[id] || !viewStateMap[id] || !viewStateMap[id].creationOptions) {
    return false
  }

  var creationOptions = viewStateMap[id].creationOptions
  var nextPreferences = Object.assign({}, creationOptions.webPreferences || getDefaultViewWebPreferences(), webPreferences || {})
  var boundsString = creationOptions.boundsString || JSON.stringify({ x: 0, y: 0, width: 1280, height: 900 })
  var events = (creationOptions.events || []).slice()
  var targetWindow = win || getWindowFromViewContents(viewMap[id].webContents) || windows.getCurrent()

  destroyView(id)
  createView(null, id, nextPreferences, boundsString, events)

  if (url) {
    loadURLInView(id, url, targetWindow)
  }

  if (targetWindow) {
    setView(id, getWindowWebContents(targetWindow))
    focusView(id)
  }

  return true
}

function getTabIDFromWebContents (contents) {
  for (var id in viewMap) {
    if (viewMap[id].webContents === contents) {
      return id
    }
  }
}

function getWindowFromViewContents (webContents) {
  const viewId = Object.keys(viewMap).find(id => viewMap[id].webContents === webContents)
  return windows.getAll().find(win => windows.getState(win).selectedView === viewId)
}

ipc.on('createView', function (e, args) {
  createView(args.existingViewId, args.id, args.webPreferences, args.boundsString, args.events)
})

ipc.on('destroyView', function (e, id) {
  destroyView(id)
})

ipc.on('destroyAllViews', function () {
  destroyAllViews()
})

ipc.on('setView', function (e, args) {
  setView(args.id, e.sender)
  setBounds(args.id, args.bounds)
  /**
   * @correction #1938 延迟刷新bounds修复切换tab后webview不显示
   * Electron WebContentsView 在同一事件循环中 addChildView + setBounds
   * 可能不触发 Native 重绘。延迟一帧再次 setBounds 强制合成器刷新。
   */
  var deferredId = args.id
  var deferredBounds = args.bounds
  setTimeout(function () {
    if (viewMap[deferredId]) {
      viewMap[deferredId].setBounds(deferredBounds)
    }
  }, 16)
  if (args.focus && BrowserWindow.fromWebContents(e.sender) && BrowserWindow.fromWebContents(e.sender).isFocused()) {
    const couldFocus = focusView(args.id)
    if (!couldFocus) {
      e.sender.focus()
    }
  }
})

ipc.on('setBounds', function (e, args) {
  setBounds(args.id, args.bounds)
})

ipc.on('focusView', function (e, id) {
  focusView(id)
})

ipc.on('hideCurrentView', function (e) {
  hideCurrentView(e.sender)
})

function loadURLInView (id, url, win) {
  // wait until the first URL is loaded to set the background color so that new tabs can use a custom background
  if (!viewStateMap[id].loadedInitialURL) {
    // Give the site a chance to display something before setting the background, in case it has its own dark theme
    viewMap[id].webContents.once('dom-ready', function() {
      viewMap[id].setBackgroundColor('#fff')
    })
    // If the view has no URL, it won't be attached yet
    if (win && id === windows.getState(win).selectedView) {
      win.getContentView().addChildView(viewMap[id])
    }
  }
  viewMap[id].webContents.loadURL(url)
  viewStateMap[id].loadedInitialURL = true
}

ipc.on('loadURLInView', function (e, args) {
  const win = windows.windowFromContents(e.sender)?.win
  loadURLInView(args.id, args.url, win)
})

ipc.on('callViewMethod', function (e, data) {
  var error, result
  try {
    var webContents = viewMap[data.id].webContents
    var methodOrProp = webContents[data.method]
    if (methodOrProp instanceof Function) {
      // call function
      result = methodOrProp.apply(webContents, data.args)
    } else {
      // set property
      if (data.args && data.args.length > 0) {
        webContents[data.method] = data.args[0]
      }
      // read property
      result = methodOrProp
    }
  } catch (e) {
    error = e
  }
  if (result instanceof Promise) {
    result.then(function (result) {
      if (data.callId) {
        e.sender.send('async-call-result', { callId: data.callId, error: null, result })
      }
    })
    result.catch(function (error) {
      if (data.callId) {
        e.sender.send('async-call-result', { callId: data.callId, error, result: null })
      }
    })
  } else if (data.callId) {
    e.sender.send('async-call-result', { callId: data.callId, error, result })
  }
})

ipc.handle('getNavigationHistory', function (e, id) {
  if (!viewMap[id]?.webContents) {
    return null
  }
  const entries = []
  const activeIndex = viewMap[id].webContents.navigationHistory.getActiveIndex()
  const size = viewMap[id].webContents.navigationHistory.length()

  for (let i = 0; i < size; i++) {
    entries.push(viewMap[id].webContents.navigationHistory.getEntryAtIndex(i))
  }

  return {
    activeIndex,
    entries
  }
})

ipc.on('getCapture', function (e, data) {
  var view = viewMap[data.id]
  if (!view) {
    // view could have been destroyed
    return
  }

  view.webContents.capturePage().then(function (img) {
    var size = img.getSize()
    if (size.width === 0 && size.height === 0) {
      return
    }
    img = img.resize({ width: data.width, height: data.height })
    e.sender.send('captureData', { id: data.id, url: img.toDataURL() })
  })
})

ipc.on('saveViewCapture', function (e, data) {
  var view = viewMap[data.id]
  if (!view) {
    // view could have been destroyed
  }

  view.webContents.capturePage().then(function (image) {
    view.webContents.downloadURL(image.toDataURL())
  })
})

global.getView = getView
