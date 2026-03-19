/* CJ Browser - Domain Shortcuts Sidebar (CJ域名快捷入口侧边栏) */

var browserUI = require('browserUI.js')
var webviews = require('webviews.js')

var cjSidebar = {
  panel: null,
  backdrop: null,
  isVisible: false,
  domains: [],
  skillsExpanded: false,

  initialize: function () {
    cjSidebar.createPanel()
    cjSidebar.createToggleButton()
    cjSidebar.loadDomains()
    cjSidebar.loadSkillsConfig()
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
      // Defensively reset proxy dot on logout
      if (!authInfo || !authInfo.loggedIn) {
        var dot = document.getElementById('cj-proxy-dot')
        if (dot) {
          dot.classList.remove('active')
          dot.classList.remove('custom')
        }
      }
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
      '<div id="cj-skills-panel" class="cj-skills-panel">',
      '  <button id="cj-skills-panel-toggle" class="cj-skills-panel-toggle" aria-expanded="false">',
      '    <span class="cj-skills-panel-heading">',
      '      <span class="cj-skills-panel-title">Skills</span>',
      '      <span id="cj-skills-panel-status" class="cj-skills-status cj-skills-status-pending">加载中</span>',
      '    </span>',
      '    <span id="cj-skills-panel-arrow" class="cj-skills-panel-arrow">展开</span>',
      '  </button>',
      '  <div id="cj-skills-content" class="cj-skills-content" style="display:none;">',
      '    <div class="cj-skills-loading">正在加载 Skills 配置...</div>',
      '  </div>',
      '</div>',
      '<div id="cj-domain-list" class="cj-domain-list"></div>',
      '<div class="cj-sidebar-footer">',
      '  <button id="cj-logout-btn" class="cj-logout-btn cj-logout-footer" style="display:none;">退出登录</button>',
      '  <span class="cj-version">v' + (globalArgs['app-version'] || '1.0.0') + '</span>',
      '</div>'
    ].join('\n')

    document.body.appendChild(panel)
    cjSidebar.panel = panel

    var backdrop = document.createElement('div')
    backdrop.id = 'cj-sidebar-backdrop'
    backdrop.className = 'cj-sidebar-backdrop'
    backdrop.addEventListener('click', function () {
      cjSidebar.hide()
    })
    document.body.appendChild(backdrop)
    cjSidebar.backdrop = backdrop

    // Close button
    document.getElementById('cj-sidebar-close').addEventListener('click', function () {
      cjSidebar.hide()
    })

    // Login button
    document.getElementById('cj-login-btn').addEventListener('click', function () {
      ipc.send('cj-auth-login')
    })

    // Footer logout button
    document.getElementById('cj-logout-btn').addEventListener('click', function () {
      ipc.send('cj-auth-logout')
    })

    document.getElementById('cj-skills-panel-toggle').addEventListener('click', function () {
      cjSidebar.setSkillsExpanded(!cjSidebar.skillsExpanded)
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

  loadSkillsConfig: function () {
    ipc.invoke('cj-automate-get-skills-config').then(function (config) {
      cjSidebar.renderSkillsPanel(config)
    }).catch(function () {
      cjSidebar.renderSkillsPanel(null)
    })
  },

  renderSkillsPanel: function (config) {
    var panel = document.getElementById('cj-skills-content')
    var status = document.getElementById('cj-skills-panel-status')
    if (!panel) return

    if (!config) {
      if (status) {
        status.className = 'cj-skills-status cj-skills-status-off'
        status.textContent = '异常'
      }
      panel.innerHTML = '<div class="cj-skills-error">Skills 配置加载失败</div>'
      return
    }

    var keyButtonText = config.keyEnabled ? '停用密钥' : '启用密钥'
    var keyStatusClass = config.keyEnabled ? 'cj-skills-status-on' : 'cj-skills-status-off'
    var keyStatusText = config.keyEnabled ? '已启用' : '已停用'
    var keyValue = cjSidebar.escapeHtml(config.token || '')
    var baseUrl = cjSidebar.escapeHtml(config.baseUrl || '')
    var skillsUrl = cjSidebar.escapeHtml(config.skillsUrl || '')

    if (status) {
      status.className = 'cj-skills-status ' + keyStatusClass
      status.textContent = keyStatusText
    }

    panel.innerHTML = [
      '<div class="cj-skills-desc">提供 AI 操作入口地址、Skills 列表地址以及本机 Skills 密钥管理。</div>',
      '<div class="cj-skills-item">',
      '  <div class="cj-skills-label">AI 操作入口</div>',
      '  <div class="cj-skills-value">' + baseUrl + '</div>',
      '  <div class="cj-skills-actions">',
      '    <button id="cj-skills-copy-base" class="cj-skills-btn">复制</button>',
      '  </div>',
      '</div>',
      '<div class="cj-skills-item">',
      '  <div class="cj-skills-label">Skills 列表</div>',
      '  <div class="cj-skills-value">' + skillsUrl + '</div>',
      '  <div class="cj-skills-actions">',
      '    <button id="cj-skills-open-list" class="cj-skills-btn">打开</button>',
      '    <button id="cj-skills-copy-list" class="cj-skills-btn">复制</button>',
      '  </div>',
      '</div>',
      '<div class="cj-skills-item">',
      '  <div class="cj-skills-label">Skills 密钥</div>',
      '  <textarea id="cj-skills-token" class="cj-skills-token" readonly>' + keyValue + '</textarea>',
      '  <div class="cj-skills-actions">',
      '    <button id="cj-skills-copy-token" class="cj-skills-btn">复制密钥</button>',
      '    <button id="cj-skills-rotate" class="cj-skills-btn cj-skills-btn-primary">生成/更换</button>',
      '    <button id="cj-skills-toggle" class="cj-skills-btn">' + keyButtonText + '</button>',
      '  </div>',
      '</div>'
    ].join('\n')

    document.getElementById('cj-skills-copy-base').addEventListener('click', function () {
      cjSidebar.copyText(config.baseUrl || '')
      cjSidebar.showToast('Skills', 'AI 操作入口已复制')
    })

    document.getElementById('cj-skills-open-list').addEventListener('click', function () {
      var newTab = tabs.add({ url: config.skillsUrl })
      browserUI.addTab(newTab, { enterEditMode: false })
      cjSidebar.hide()
    })

    document.getElementById('cj-skills-copy-list').addEventListener('click', function () {
      cjSidebar.copyText(config.skillsUrl || '')
      cjSidebar.showToast('Skills', 'Skills 列表地址已复制')
    })

    document.getElementById('cj-skills-copy-token').addEventListener('click', function () {
      cjSidebar.copyText(config.token || '')
      cjSidebar.showToast('Skills', 'Skills 密钥已复制')
    })

    document.getElementById('cj-skills-rotate').addEventListener('click', function () {
      ipc.invoke('cj-automate-rotate-skills-key').then(function (nextConfig) {
        cjSidebar.renderSkillsPanel(nextConfig)
        cjSidebar.showToast('Skills', 'Skills 密钥已生成/更换')
      }).catch(function (err) {
        cjSidebar.showToast('Skills', err && err.message ? err.message : 'Skills 密钥更换失败', 'error')
      })
    })

    document.getElementById('cj-skills-toggle').addEventListener('click', function () {
      ipc.invoke('cj-automate-set-skills-key-enabled', !config.keyEnabled).then(function (nextConfig) {
        cjSidebar.renderSkillsPanel(nextConfig)
        cjSidebar.showToast('Skills', nextConfig.keyEnabled ? 'Skills 密钥已启用' : 'Skills 密钥已停用')
      }).catch(function (err) {
        cjSidebar.showToast('Skills', err && err.message ? err.message : 'Skills 密钥状态更新失败', 'error')
      })
    })
  },

  setSkillsExpanded: function (expanded) {
    cjSidebar.skillsExpanded = !!expanded

    var content = document.getElementById('cj-skills-content')
    var toggle = document.getElementById('cj-skills-panel-toggle')
    var arrow = document.getElementById('cj-skills-panel-arrow')

    if (content) {
      content.style.display = cjSidebar.skillsExpanded ? 'block' : 'none'
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', cjSidebar.skillsExpanded ? 'true' : 'false')
    }
    if (arrow) {
      arrow.textContent = cjSidebar.skillsExpanded ? '收起' : '展开'
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
      // Update flower name
      var nameEl = document.getElementById('cj-toggle-name')
      if (nameEl) {
        nameEl.textContent = authInfo.user.name || ''
        if (cjSidebar.isVisible && authInfo.user.name) nameEl.style.display = 'inline'
      }
    } else {
      // Revert to CJ text
      if (avatarEl) avatarEl.style.display = 'none'
      if (iconEl) iconEl.style.display = 'inline'
      var nameEl = document.getElementById('cj-toggle-name')
      if (nameEl) {
        nameEl.textContent = ''
        nameEl.style.display = 'none'
      }
    }
  },

  createToggleButton: function () {
    var btn = document.createElement('button')
    btn.id = 'cj-sidebar-toggle'
    btn.className = 'cj-sidebar-toggle'
    btn.title = 'CJ 快捷入口'
    btn.innerHTML = '<span class="cj-toggle-icon">CJ</span><span class="cj-toggle-name" id="cj-toggle-name" style="display:none;"></span><span class="cj-proxy-dot" id="cj-proxy-dot"></span><span class="cj-env-dot" id="cj-env-dot" style="display:none;"></span>'
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

    var user = ipc.sendSync('cj-auth-getUser')
    if (user) {
      cjSidebar.updateToggleButton({ loggedIn: true, user: user })
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
    if (cjSidebar.backdrop) {
      cjSidebar.backdrop.classList.add('visible')
    }
    cjSidebar.isVisible = true
    var nameEl = document.getElementById('cj-toggle-name')
    if (nameEl && nameEl.textContent) nameEl.style.display = 'inline'
    webviews.requestPlaceholder('sidebar')
  },

  hide: function () {
    cjSidebar.panel.classList.remove('visible')
    if (cjSidebar.backdrop) {
      cjSidebar.backdrop.classList.remove('visible')
    }
    cjSidebar.isVisible = false
    var nameEl = document.getElementById('cj-toggle-name')
    if (nameEl) nameEl.style.display = 'none'
    webviews.hidePlaceholder('sidebar')
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
      cjSidebar.showToast('网络模式已切换', msg)
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
    var username = data.username || '未知用户'
    cjSidebar.showToast('已自动登录', '欢迎, ' + username)
  },

  showToast: function (title, message, type) {
    var existing = document.getElementById('cj-auto-login-toast')
    if (existing) existing.remove()

    var toast = document.createElement('div')
    toast.id = 'cj-auto-login-toast'
    toast.className = 'cj-auto-login-toast ' + (type === 'error' ? 'cj-toast-error' : 'cj-toast-success')

    toast.innerHTML = [
      '<div class="cj-toast-content">',
      '  <div class="cj-toast-title">' + cjSidebar.escapeHtml(title || '提示') + '</div>',
      '  <div class="cj-toast-msg">' + cjSidebar.escapeHtml(message || '') + '</div>',
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

  copyText: function (text) {
    if (!text) return

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {})
      return
    }

    var input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', 'readonly')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  },

  updateUserInfo: function (authInfo) {
    var userInfoEl = document.getElementById('cj-user-info')
    if (!userInfoEl) return

    var footerLogout = document.getElementById('cj-logout-btn')
    if (authInfo && authInfo.loggedIn && authInfo.user) {
      userInfoEl.innerHTML = ''
      userInfoEl.style.display = 'none'
      if (footerLogout) footerLogout.style.display = 'block'
    } else {
      userInfoEl.style.display = 'block'
      userInfoEl.innerHTML = '<button id="cj-login-btn" class="cj-login-btn">企业微信登录</button>'
      document.getElementById('cj-login-btn').addEventListener('click', function () {
        ipc.send('cj-auth-login')
      })
      if (footerLogout) footerLogout.style.display = 'none'
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
