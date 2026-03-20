window.globalArgs = {}

process.argv.forEach(function (arg) {
  if (arg.startsWith('--')) {
    var key = arg.split('=')[0].replace('--', '')
    var value = arg.split('=')[1]
    globalArgs[key] = value
  }
})

window.windowId = globalArgs['window-id']

window.electron = require('electron')
window.fs = require('fs')
window.EventEmitter = require('events')
window.ipc = electron.ipcRenderer

var webviews = require('webviews.js')

if (navigator.platform === 'MacIntel') {
  document.body.classList.add('mac')
  window.platformType = 'mac'
} else if (navigator.platform === 'Win32') {
  document.body.classList.add('windows')
  window.platformType = 'windows'
} else {
  document.body.classList.add('linux')
  window.platformType = 'linux'
}

if (navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch')
}

/* add classes so that the window state can be used in CSS */
ipc.on('enter-full-screen', function () {
  document.body.classList.add('fullscreen')
})

ipc.on('leave-full-screen', function () {
  document.body.classList.remove('fullscreen')
})

ipc.on('maximize', function () {
  document.body.classList.add('maximized')
})

ipc.on('unmaximize', function () {
  document.body.classList.remove('maximized')
})

document.body.classList.add('focused')

ipc.on('focus', function () {
  document.body.classList.add('focused')
})

ipc.on('blur', function () {
  document.body.classList.remove('focused')
})

var originalEmitEvent = webviews.emitEvent.bind(webviews)
webviews.emitEvent = function (event, tabId, args) {
  if (event === 'did-fail-load') {
    var errorCode = args && args[0]
    var validatedURL = args && args[2]
    var isMainFrame = args && args[3]

    if (errorCode === -118 && isMainFrame && validatedURL && /^https?:/i.test(validatedURL)) {
      ipc.invoke('cj-handle-load-failure', {
        tabId: tabId,
        errorCode: errorCode,
        errorDesc: args[1],
        validatedURL: validatedURL,
        isMainFrame: isMainFrame
      }).then(function (result) {
        if (result && result.handled && result.reload && webviews.hasViewForTab(tabId)) {
          tabs.update(tabId, {
            url: validatedURL
          })
          setTimeout(function () {
            if (webviews.hasViewForTab(tabId)) {
              webviews.callAsync(tabId, 'loadURL', [validatedURL])
            }
          }, result.delayMs || 600)
          return
        }

        originalEmitEvent(event, tabId, args)
      }).catch(function () {
        originalEmitEvent(event, tabId, args)
      })
      return
    }
  }

  originalEmitEvent(event, tabId, args)
}

ipc.on('cj-proxy-refresh-current-tab', function () {
  var selectedTab = tabs.getSelected()
  var selectedData = selectedTab ? tabs.get(selectedTab) : null

  if (!selectedTab || !selectedData || !selectedData.url || selectedData.url.indexOf('min://') === 0) {
    return
  }

  webviews.callAsync(selectedTab, 'reloadIgnoringCache')
})

// https://remysharp.com/2010/07/21/throttling-function-calls

window.throttle = function (fn, threshhold, scope) {
  threshhold || (threshhold = 250)
  var last,
    deferTimer
  return function () {
    var context = scope || this

    var now = +new Date()
    var args = arguments
    if (last && now < last + threshhold) {
      // hold on to it
      clearTimeout(deferTimer)
      deferTimer = setTimeout(function () {
        last = now
        fn.apply(context, args)
      }, threshhold)
    } else {
      last = now
      fn.apply(context, args)
    }
  }
}

// https://remysharp.com/2010/07/21/throttling-function-calls

window.debounce = function (fn, delay) {
  var timer = null
  return function () {
    var context = this
    var args = arguments
    clearTimeout(timer)
    timer = setTimeout(function () {
      fn.apply(context, args)
    }, delay)
  }
}

window.empty = function (node) {
  var n
  while (n = node.firstElementChild) {
    node.removeChild(n)
  }
}

/* prevent a click event from firing after dragging the window */

window.addEventListener('load', function () {
  var isMouseDown = false
  var isDragging = false
  var distance = 0

  document.body.addEventListener('mousedown', function () {
    isMouseDown = true
    isDragging = false
    distance = 0
  })

  document.body.addEventListener('mouseup', function () {
    isMouseDown = false
  })

  var dragHandles = document.getElementsByClassName('windowDragHandle')

  for (var i = 0; i < dragHandles.length; i++) {
    dragHandles[i].addEventListener('mousemove', function (e) {
      if (isMouseDown) {
        isDragging = true
        distance += Math.abs(e.movementX) + Math.abs(e.movementY)
      }
    })
  }

  document.body.addEventListener('click', function (e) {
    if (isDragging && distance >= 10.0) {
      e.stopImmediatePropagation()
      isDragging = false
    }
  }, true)
})

require('tabState.js').initialize()
require('tabState/windowSync.js').initialize()
require('windowControls.js').initialize()
require('navbar/menuButton.js').initialize()

require('navbar/addTabButton.js').initialize()
require('navbar/tabContextMenu.js').initialize()
require('navbar/tabActivity.js').initialize()
require('navbar/tabColor.js').initialize()
require('navbar/navigationButtons.js').initialize()
require('downloadManager.js').initialize()
require('webviewMenu.js').initialize()
require('contextMenu.js').initialize()
require('menuRenderer.js').initialize()
require('defaultKeybindings.js').initialize()
require('pdfViewer.js').initialize()
require('autofillSetup.js').initialize()
require('passwordManager/passwordManager.js').initialize()
require('passwordManager/passwordCapture.js').initialize()
require('passwordManager/passwordViewer.js').initialize()
require('util/theme.js').initialize()
require('userscripts.js').initialize()
require('statistics.js').initialize()
require('taskOverlay/taskOverlay.js').initialize()
require('sessionRestore.js').initialize()
require('bookmarkConverter.js').initialize()
require('newTabPage.js').initialize()
require('macHandoff.js').initialize()

// default searchbar plugins

require('searchbar/placesPlugin.js').initialize()
require('searchbar/instantAnswerPlugin.js').initialize()
require('searchbar/bangsPlugin.js').initialize()
require('searchbar/customBangs.js').initialize()
require('searchbar/searchSuggestionsPlugin.js').initialize()
require('searchbar/placeSuggestionsPlugin.js').initialize()
require('searchbar/updateNotifications.js').initialize()
require('searchbar/restoreTaskPlugin.js').initialize()

// CJ Browser - Domain Sidebar
require('navbar/cjSidebar.js').initialize()
require('searchbar/bookmarkManager.js').initialize()
require('searchbar/historyViewer.js').initialize()
require('searchbar/developmentModeNotification.js').initialize()
require('searchbar/shortcutButtons.js').initialize()
require('searchbar/calculatorPlugin.js').initialize()

// CJ Browser - Non-blocking update notification
;(function () {
  var updateBar = null

  ipc.on('cj-update-available', function (event, info) {
    if (updateBar && updateBar.parentNode) {
      updateBar.parentNode.removeChild(updateBar)
    }

    updateBar = document.createElement('div')
    updateBar.id = 'cj-update-bar'
    updateBar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:999999;display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 16px;background:#1a73e8;color:#fff;font-size:13px;font-family:system-ui,sans-serif;box-shadow:0 -2px 8px rgba(0,0,0,.18);'

    var platformLabel = info.platformLabel || '应用'
    var msg = document.createElement('span')
    msg.textContent = '发现新的 ' + platformLabel + ' 版本 v' + info.latestVersion + '（当前 v' + info.currentVersion + '）'
    updateBar.appendChild(msg)

    if (info.downloadUrl) {
      var btn = document.createElement('button')
      btn.textContent = '下载' + platformLabel + '版'
      btn.style.cssText = 'border:1px solid #fff;background:transparent;color:#fff;padding:3px 12px;border-radius:3px;cursor:pointer;font-size:12px;'
      btn.addEventListener('click', function () {
        ipc.send('cj-update-download', info.downloadUrl)
      })
      updateBar.appendChild(btn)
    }

    var close = document.createElement('button')
    close.textContent = '×'
    close.style.cssText = 'border:none;background:transparent;color:#fff;font-size:18px;cursor:pointer;padding:0 4px;line-height:1;'
    close.addEventListener('click', function () {
      if (updateBar.parentNode) updateBar.parentNode.removeChild(updateBar)
      ipc.send('cj-update-dismiss')
    })
    updateBar.appendChild(close)

    document.body.appendChild(updateBar)
  })
})()

// once everything's loaded, start the session
require('sessionRestore.js').restore()
