/* CJ Browser - Domain Shortcuts Sidebar (CJ域名快捷入口侧边栏) */

var browserUI = require('browserUI.js')
var webviews = require('webviews.js')

var cjSidebar = {
  panel: null,
  isVisible: false,
  domains: [],

  initialize: function () {
    cjSidebar.createPanel()
    cjSidebar.createToggleButton()
    cjSidebar.loadDomains()
    cjSidebar.setupClickOutside()

    // Listen for domain updates from main process
    ipc.on('cj-domains-updated', function (e, domains) {
      cjSidebar.domains = domains
      cjSidebar.renderDomains()
    })

    // Listen for auth changes to show user info
    ipc.on('cj-auth-changed', function (e, authInfo) {
      cjSidebar.updateUserInfo(authInfo)
      cjSidebar.updateToggleButton(authInfo)
    })

    // Listen for proxy status changes
    ipc.on('cj-proxy-status', function (e, status) {
      cjSidebar.renderProxyStatus(status)
    })

    // Listen for environment changes
    ipc.on('cj-env-changed', function (e, envInfo) {
      cjSidebar.renderEnvBadge(envInfo)
    })

    // Listen for auto-login success notification from main process
    ipc.on('cj-auto-login-success', function (e, data) {
      cjSidebar.showAutoLoginSuccess(data)
    })

    // Listen for login navigation request (open CJ login page in browser tab)
    ipc.on('cj-navigate-for-login', function (e, data) {
      if (data && data.url) {
        var newTab = tabs.add({ url: data.url })
        browserUI.addTab(newTab, { enterEditMode: false })
      }
    })

  },

  createPanel: function () {
    var panel = document.createElement('div')
    panel.id = 'cj-sidebar'
    panel.className = 'cj-sidebar'
    panel.innerHTML = [
      '<div class="cj-sidebar-header">',
      '  <div class="cj-sidebar-logo">',
      '    <span class="cj-logo-text">CJ</span>',
      '    <span class="cj-logo-title">内部浏览器</span>',
      '  </div>',
      '  <button id="cj-sidebar-close" class="cj-sidebar-close">&times;</button>',
      '</div>',
      '<div id="cj-env-badge" class="cj-env-badge" style="display:none;"></div>',
      '<div id="cj-user-info" class="cj-user-info">',
      '  <button id="cj-login-btn" class="cj-login-btn">企业微信登录</button>',
      '</div>',
      '<div id="cj-proxy-status" class="cj-proxy-status"></div>',
      '<div id="cj-proxy-settings" class="cj-proxy-settings" style="display:none;">',
      '  <div class="cj-proxy-mode-selector">',
      '    <label class="cj-proxy-mode-option">',
      '      <input type="radio" name="cj-proxy-mode" value="company" id="cj-proxy-mode-company">',
      '      <span>公司代理</span>',
      '    </label>',
      '    <label class="cj-proxy-mode-option">',
      '      <input type="radio" name="cj-proxy-mode" value="direct" id="cj-proxy-mode-direct">',
      '      <span>直接访问</span>',
      '    </label>',
      '  </div>',
      '</div>',
      '<div id="cj-domain-list" class="cj-domain-list"></div>',
      '<div class="cj-sidebar-footer">',
      '  <span class="cj-version">v' + (globalArgs['app-version'] || '1.0.0') + '</span>',
      '</div>'
    ].join('\n')

    document.body.appendChild(panel)
    cjSidebar.panel = panel

    // Close button
    document.getElementById('cj-sidebar-close').addEventListener('click', function () {
      cjSidebar.hide()
    })

    // Login button
    document.getElementById('cj-login-btn').addEventListener('click', function () {
      ipc.send('cj-auth-login')
    })

    // Proxy mode radio buttons
    document.getElementById('cj-proxy-mode-company').addEventListener('change', function () {
      if (this.checked) {
        ipc.send('cj-proxy-set-mode', 'company')
      }
    })
    document.getElementById('cj-proxy-mode-direct').addEventListener('change', function () {
      if (this.checked) {
        ipc.send('cj-proxy-set-mode', 'direct')
      }
    })

    // Check initial auth state
    var user = ipc.sendSync('cj-auth-getUser')
    if (user) {
      cjSidebar.updateUserInfo({ loggedIn: true, user: user })
      cjSidebar.updateToggleButton({ loggedIn: true, user: user })
    }
  },

  updateToggleButton: function (authInfo) {
    var btn = document.getElementById('cj-sidebar-toggle')
    if (!btn) return

    var iconEl = btn.querySelector('.cj-toggle-icon')
    var avatarEl = btn.querySelector('.cj-toggle-avatar')

    if (authInfo && authInfo.loggedIn && authInfo.user && authInfo.user.avatar) {
      // Replace CJ text with user avatar
      if (iconEl) iconEl.style.display = 'none'
      if (!avatarEl) {
        avatarEl = document.createElement('img')
        avatarEl.className = 'cj-toggle-avatar'
        avatarEl.alt = ''
        btn.insertBefore(avatarEl, btn.firstChild)
      }
      avatarEl.src = authInfo.user.avatar
      avatarEl.style.display = 'block'
    } else {
      // Revert to CJ text
      if (avatarEl) avatarEl.style.display = 'none'
      if (iconEl) iconEl.style.display = 'inline'
    }
  },

  createToggleButton: function () {
    var btn = document.createElement('button')
    btn.id = 'cj-sidebar-toggle'
    btn.className = 'cj-sidebar-toggle'
    btn.title = 'CJ 快捷入口'
    btn.innerHTML = '<span class="cj-toggle-icon">CJ</span><span class="cj-proxy-dot" id="cj-proxy-dot"></span><span class="cj-env-dot" id="cj-env-dot" style="display:none;"></span>'
    btn.addEventListener('click', function () {
      cjSidebar.toggle()
    })

    var navbar = document.getElementById('navbar')
    if (navbar) {
      var menuBtn = document.getElementById('menu-button')
      if (menuBtn) {
        navbar.insertBefore(btn, menuBtn)
      } else {
        navbar.insertBefore(btn, navbar.firstChild)
      }
    } else {
      document.body.appendChild(btn)
    }
  },

  setupClickOutside: function () {
    document.addEventListener('click', function (e) {
      if (!cjSidebar.isVisible) return
      var panel = cjSidebar.panel
      var toggle = document.getElementById('cj-sidebar-toggle')
      if (panel && !panel.contains(e.target) && toggle && !toggle.contains(e.target)) {
        cjSidebar.hide()
      }
    })
  },

  toggle: function () {
    if (cjSidebar.isVisible) {
      cjSidebar.hide()
    } else {
      cjSidebar.show()
    }
  },

  show: function () {
    cjSidebar.panel.classList.add('visible')
    cjSidebar.isVisible = true
    webviews.adjustMargin([0, 0, 0, 260])
  },

  hide: function () {
    cjSidebar.panel.classList.remove('visible')
    cjSidebar.isVisible = false
    webviews.adjustMargin([0, 0, 0, -260])
  },

  loadDomains: function () {
    // Domains loaded from backend only, show empty state until loaded
    cjSidebar.domains = []
    cjSidebar.renderDomains()
  },

  renderDomains: function () {
    var container = document.getElementById('cj-domain-list')
    if (!container) return

    container.innerHTML = ''

    if (!cjSidebar.domains || cjSidebar.domains.length === 0) {
      var empty = document.createElement('div')
      empty.className = 'cj-domain-empty'
      empty.textContent = '等待服务器配置加载...'
      container.appendChild(empty)
      return
    }

    var categories = {}
    cjSidebar.domains.forEach(function (domain) {
      var cat = domain.category || '其他'
      if (!categories[cat]) {
        categories[cat] = []
      }
      categories[cat].push(domain)
    })

    Object.keys(categories).forEach(function (catName) {
      var section = document.createElement('div')
      section.className = 'cj-domain-section'

      var header = document.createElement('div')
      header.className = 'cj-domain-category'
      header.textContent = catName
      section.appendChild(header)

      categories[catName].forEach(function (domain) {
        var item = document.createElement('a')
        item.className = 'cj-domain-item'
        item.href = '#'
        item.innerHTML = '<span class="cj-domain-icon">' + (domain.icon || '🌐') + '</span>' +
          '<span class="cj-domain-name">' + cjSidebar.escapeHtml(domain.name) + '</span>'
        item.addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()
          // Check if there's an existing tab with a matching URL
          var existingTab = cjSidebar.findTabByDomain(domain.url)
          if (existingTab) {
            browserUI.switchToTab(existingTab.id)
          } else {
            var newTab = tabs.add({ url: domain.url })
            browserUI.addTab(newTab, { enterEditMode: false })
          }
          cjSidebar.hide()
        })
        section.appendChild(item)
      })

      container.appendChild(section)
    })
  },

  renderProxyStatus: function (status) {
    var container = document.getElementById('cj-proxy-status')
    var dot = document.getElementById('cj-proxy-dot')
    var settings = document.getElementById('cj-proxy-settings')
    var companyRadio = document.getElementById('cj-proxy-mode-company')
    var directRadio = document.getElementById('cj-proxy-mode-direct')

    var prevEnabled = cjSidebar._lastProxyEnabled
    var prevSource = cjSidebar._lastProxySource
    var changed = (prevEnabled !== undefined && (prevEnabled !== !!(status && status.enabled) || prevSource !== (status && status.source)))
    cjSidebar._lastProxyEnabled = !!(status && status.enabled)
    cjSidebar._lastProxySource = (status && status.source) || 'none'

    if (container) {
      if (status && status.enabled) {
        container.innerHTML = '<span class="cj-proxy-badge cj-proxy-on">当前网络：公司代理</span>'
      } else {
        container.innerHTML = '<span class="cj-proxy-badge cj-proxy-off">当前网络：直接访问</span>'
      }
    }
    if (dot) {
      if (status && status.enabled) {
        dot.classList.add('active')
        dot.classList.remove('custom')
      } else {
        dot.classList.remove('active')
        dot.classList.remove('custom')
      }
      // Pulse animation on change
      if (changed) {
        dot.classList.add('switching')
        setTimeout(function () { dot.classList.remove('switching') }, 800)
      }
    }
    // Show proxy settings only when logged in
    if (settings && status && status.loggedIn) {
      settings.style.display = 'block'
      if (companyRadio && directRadio) {
        if (status.enabled) {
          companyRadio.checked = true
          directRadio.checked = false
        } else {
          companyRadio.checked = false
          directRadio.checked = true
        }
      }
    } else if (settings) {
      settings.style.display = 'none'
    }

    // Toast notification on mode change
    if (changed) {
      var msg
      if (status && status.enabled) {
        msg = '已切换到公司代理模式'
      } else {
        msg = '已切换到直连模式'
      }
      cjSidebar.showAutoLoginSuccess({ username: msg })
    }
  },

  renderEnvBadge: function (envInfo) {
    var badge = document.getElementById('cj-env-badge')
    var envDot = document.getElementById('cj-env-dot')
    if (!envInfo) return

    if (badge) {
      if (envInfo.current !== 'production') {
        badge.style.display = 'block'
        badge.textContent = envInfo.label
        badge.className = 'cj-env-badge cj-env-' + envInfo.current
      } else {
        badge.style.display = 'none'
      }
    }
    if (envDot) {
      if (envInfo.current !== 'production') {
        envDot.style.display = 'inline-block'
        envDot.textContent = envInfo.label.charAt(0)
        envDot.className = 'cj-env-dot cj-env-dot-' + envInfo.current
      } else {
        envDot.style.display = 'none'
      }
    }
  },

  showAutoLoginSuccess: function (data) {
    // Remove existing notification
    var existing = document.getElementById('cj-auto-login-toast')
    if (existing) existing.remove()

    var toast = document.createElement('div')
    toast.id = 'cj-auto-login-toast'
    toast.className = 'cj-auto-login-toast cj-toast-success'

    var username = data.username || '未知用户'

    toast.innerHTML = [
      '<div class="cj-toast-content">',
      '  <div class="cj-toast-title">✓ 已自动登录</div>',
      '  <div class="cj-toast-msg">欢迎, <b>' + cjSidebar.escapeHtml(username) + '</b></div>',
      '</div>'
    ].join('\n')

    document.body.appendChild(toast)

    // Auto-dismiss after 3 seconds
    setTimeout(function () {
      if (toast.parentNode) {
        toast.classList.add('cj-toast-fadeout')
        setTimeout(function () { toast.remove() }, 300)
      }
    }, 3000)
  },

  updateUserInfo: function (authInfo) {
    var userInfoEl = document.getElementById('cj-user-info')
    if (!userInfoEl) return

    if (authInfo && authInfo.loggedIn && authInfo.user) {
      var avatarHtml
      if (authInfo.user.avatar) {
        avatarHtml = '<img class="cj-user-avatar-img" src="' + cjSidebar.escapeHtml(authInfo.user.avatar) + '" alt="">'
      } else {
        avatarHtml = '<span class="cj-user-avatar">' + (authInfo.user.name ? authInfo.user.name.charAt(0) : '?') + '</span>'
      }
      userInfoEl.innerHTML = [
        '<div class="cj-user-card">',
        '  ' + avatarHtml,
        '  <span class="cj-user-name">' + cjSidebar.escapeHtml(authInfo.user.name || '') + '</span>',
        '  <button id="cj-logout-btn" class="cj-logout-btn">退出</button>',
        '</div>'
      ].join('\n')

      document.getElementById('cj-logout-btn').addEventListener('click', function () {
        ipc.send('cj-auth-logout')
      })

    } else {
      userInfoEl.innerHTML = '<button id="cj-login-btn" class="cj-login-btn">企业微信登录</button>'
      document.getElementById('cj-login-btn').addEventListener('click', function () {
        ipc.send('cj-auth-login')
      })
    }
  },

  escapeHtml: function (text) {
    var div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  },

  findTabByDomain: function (targetUrl) {
    var allTabs = tabs.get()
    if (!allTabs || !targetUrl) return null

    try {
      var targetHost = new URL(targetUrl).hostname
    } catch (e) {
      return null
    }

    for (var i = 0; i < allTabs.length; i++) {
      var tab = allTabs[i]
      if (!tab.url) continue
      try {
        var tabHost = new URL(tab.url).hostname
        if (tabHost === targetHost) {
          return tab
        }
      } catch (e) {
        continue
      }
    }
    return null
  }
}

module.exports = cjSidebar
