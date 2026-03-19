/* CJ Browser - Operation Tracking (操作记录自动上报) */

/* electron modules: net, app are available from main.js */

var cjTracker = {
  buffer: [],
  flushInterval: null,
  maxBufferSize: 10,
  flushIntervalMs: 30000, // 30 seconds

  initialize: function () {
    // Start periodic flush
    cjTracker.flushInterval = setInterval(function () {
      cjTracker.flush()
    }, cjTracker.flushIntervalMs)

    // Flush on app quit
    app.on('before-quit', function () {
      cjTracker.flush()
    })

    console.log('[CJ Tracker] Initialized')
  },

  /**
   * Track a page navigation event
   */
  trackPageView: function (url, title, tabId) {
    if (!url || url.startsWith('min://') || url === 'about:blank') {
      return
    }

    cjTracker.addEvent({
      action: 'PAGE_VIEW',
      url: url,
      title: title || '',
      tabId: tabId
    })
  },

  /**
   * Track a search event
   */
  trackSearch: function (query) {
    cjTracker.addEvent({
      action: 'SEARCH',
      url: '',
      title: query
    })
  },

  /**
   * Track a download event
   */
  trackDownload: function (url, filename) {
    cjTracker.addEvent({
      action: 'DOWNLOAD',
      url: url,
      title: filename || ''
    })
  },

  /**
   * Track login/logout
   */
  trackAuth: function (action) {
    cjTracker.addEvent({
      action: action, // LOGIN or LOGOUT
      url: '',
      title: ''
    })
  },

  addEvent: function (event) {
    var user = cjAuth.getUser()

    cjTracker.buffer.push({
      userId: user ? user.userId : 'anonymous',
      userName: user ? user.name : 'anonymous',
      action: event.action,
      url: event.url,
      title: event.title,
      clientVersion: app.getVersion(),
      osType: process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'Mac' : 'Linux'),
      createdAt: new Date().toISOString()
    })

    // Auto-flush when buffer is full
    if (cjTracker.buffer.length >= cjTracker.maxBufferSize) {
      cjTracker.flush()
    }
  },

  flush: function () {
    if (cjTracker.buffer.length === 0) {
      return
    }

    var events = cjTracker.buffer.splice(0)
    var backendUrl = cjConfig.getBackendUrl()
    var token = cjAuth.getToken()

    try {
      var request = net.request({
        method: 'POST',
        url: backendUrl + '/api/browser/log'
      })

      request.setHeader('Content-Type', 'application/json')
      if (token) {
        request.setHeader('Authorization', 'Bearer ' + token)
      }

      request.on('response', function (response) {
        if (response.statusCode !== 200) {
          console.warn('[CJ Tracker] Upload failed, status:', response.statusCode)
          // Put events back if upload failed
          cjTracker.buffer = events.concat(cjTracker.buffer)
        } else {
          console.log('[CJ Tracker] Uploaded', events.length, 'events')
        }
        // drain response
        response.on('data', function () {})
      })

      request.on('error', function (err) {
        console.warn('[CJ Tracker] Upload error:', err.message)
        // Put events back
        cjTracker.buffer = events.concat(cjTracker.buffer)
      })

      request.write(JSON.stringify({ logs: events }))
      request.end()
    } catch (e) {
      console.warn('[CJ Tracker] Request error:', e.message)
      cjTracker.buffer = events.concat(cjTracker.buffer)
    }
  }
}

module.exports = cjTracker
