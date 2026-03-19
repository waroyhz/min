/* CJ Browser - Remote Automation Scripts Manager (远程自动化脚本管理器)
 *
 * Scripts are open-sourced and published remotely.
 * This module fetches a script manifest from a remote URL,
 * downloads scripts to Min's userscripts directory, and keeps them up to date.
 * Scripts then run via Min's built-in Tampermonkey-compatible userscripts engine.
 *
 * Remote manifest format (JSON):
 * {
 *   "version": "1",
 *   "scripts": [
 *     {
 *       "name": "CJ Auto Login",
 *       "filename": "cj-auto-login.js",
 *       "url": "https://raw.githubusercontent.com/.../cj-auto-login.js",
 *       "checksum": "sha256:abc123",
 *       "description": "Auto-fill CJ login form"
 *     }
 *   ]
 * }
 */

var crypto = require('crypto')
/* electron modules: net, app, ipc, fs, path are available from main.js */

// ─── Configuration ────────────────────────────────────────────────────────────

// Primary: backend API
const REMOTE_MANIFEST_URL = 'http://localhost:9991/cj-openai-chat-web/api/browser/scripts/manifest'

// Fallback: public GitHub/GitLab manifest (open-sourced)
const FALLBACK_MANIFEST_URL = 'https://raw.githubusercontent.com/cjdropshipping/cj-browser-scripts/main/manifest.json'

// Check interval: every 6 hours
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// ─── State ────────────────────────────────────────────────────────────────────

var cjScripts = {
  userscriptsDir: null,
  manifestCachePath: null,
  checkIntervalHandle: null,

  initialize: function (userDataPath) {
    cjScripts.userscriptsDir = path.join(userDataPath, 'userscripts')
    cjScripts.manifestCachePath = path.join(userDataPath, 'cj-scripts-manifest.json')

    // Ensure userscripts directory exists
    if (!fs.existsSync(cjScripts.userscriptsDir)) {
      try { fs.mkdirSync(cjScripts.userscriptsDir, { recursive: true }) } catch (e) { /* ignore */ }
    }

    // Fetch scripts on startup (with short delay to let the app settle)
    setTimeout(function () {
      cjScripts.checkAndUpdate()
    }, 8000)

    // Periodic re-check
    cjScripts.checkIntervalHandle = setInterval(function () {
      cjScripts.checkAndUpdate()
    }, CHECK_INTERVAL_MS)

    // IPC: renderer can request a manual refresh
    ipc.on('cj-scripts-refresh', function (e) {
      cjScripts.checkAndUpdate().then(function (result) {
        if (e.sender && !e.sender.isDestroyed()) {
          e.sender.send('cj-scripts-refresh-done', result)
        }
      })
    })

    // IPC: get installed script list
    ipc.handle('cj-scripts-list', function () {
      return cjScripts.getInstalledScripts()
    })

    console.log('[CJ Scripts] Initialized, userscripts dir:', cjScripts.userscriptsDir)
  },

  /**
   * Fetch manifest, compare with cached version, download new/updated scripts.
   */
  checkAndUpdate: function () {
    return cjScripts.fetchManifest(REMOTE_MANIFEST_URL)
      .catch(function () {
        console.log('[CJ Scripts] Primary manifest failed, trying fallback...')
        return cjScripts.fetchManifest(FALLBACK_MANIFEST_URL)
      })
      .then(function (manifest) {
        if (!manifest || !Array.isArray(manifest.scripts)) {
          console.log('[CJ Scripts] Invalid manifest')
          return { updated: 0, total: 0 }
        }

        var cachedManifest = cjScripts.loadCachedManifest()
        var updated = 0

        var downloadPromises = manifest.scripts.map(function (scriptMeta) {
          var needsUpdate = true
          if (cachedManifest) {
            var cached = cachedManifest.scripts.find(function (s) { return s.filename === scriptMeta.filename })
            if (cached && cached.checksum === scriptMeta.checksum) {
              needsUpdate = false
            }
          }

          if (needsUpdate) {
            return cjScripts.downloadScript(scriptMeta).then(function (ok) {
              if (ok) updated++
              return ok
            })
          }
          return Promise.resolve(false)
        })

        return Promise.all(downloadPromises).then(function () {
          // Save updated manifest to cache
          fs.writeFileSync(cjScripts.manifestCachePath, JSON.stringify(manifest, null, 2))
          if (updated > 0) {
            console.log('[CJ Scripts] Updated', updated, 'scripts, total:', manifest.scripts.length)
            // Notify all renderer windows to reload userscripts
            windows.getAll().forEach(function (win) {
              getWindowWebContents(win).send('cj-scripts-updated', {
                updated: updated,
                total: manifest.scripts.length
              })
            })
          } else {
            console.log('[CJ Scripts] All scripts up to date,', manifest.scripts.length, 'scripts')
          }
          return { updated: updated, total: manifest.scripts.length }
        })
      })
      .catch(function (err) {
        console.warn('[CJ Scripts] Update failed:', err.message)
        return { updated: 0, total: 0, error: err.message }
      })
  },

  /**
   * Fetch JSON manifest from URL using Electron's net module (goes through proxy)
   */
  fetchManifest: function (url) {
    return new Promise(function (resolve, reject) {
      var request = net.request({ method: 'GET', url: url })
      var body = ''
      var timeout = setTimeout(function () { request.abort(); reject(new Error('Manifest fetch timeout')) }, 15000)

      request.on('response', function (response) {
        response.on('data', function (chunk) { body += chunk.toString() })
        response.on('end', function () {
          clearTimeout(timeout)
          if (response.statusCode === 200) {
            try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('Invalid JSON: ' + e.message)) }
          } else {
            reject(new Error('HTTP ' + response.statusCode))
          }
        })
      })

      request.on('error', function (err) { clearTimeout(timeout); reject(err) })
      request.end()
    })
  },

  /**
   * Download a single script and save to userscripts directory
   */
  downloadScript: function (scriptMeta) {
    return new Promise(function (resolve) {
      var request = net.request({ method: 'GET', url: scriptMeta.url })
      var body = ''
      var timeout = setTimeout(function () { request.abort(); resolve(false) }, 30000)

      request.on('response', function (response) {
        response.on('data', function (chunk) { body += chunk.toString() })
        response.on('end', function () {
          clearTimeout(timeout)
          if (response.statusCode !== 200) { resolve(false); return }

          // Verify checksum if provided
          if (scriptMeta.checksum && scriptMeta.checksum.startsWith('sha256:')) {
            var expected = scriptMeta.checksum.replace('sha256:', '')
            var actual = crypto.createHash('sha256').update(body).digest('hex')
            if (actual !== expected) {
              console.warn('[CJ Scripts] Checksum mismatch for', scriptMeta.filename)
              resolve(false)
              return
            }
          }

          // Validate: must look like a JS userscript (security check)
          if (typeof body !== 'string' || body.length === 0) {
            resolve(false)
            return
          }

          // Save to userscripts directory
          var destPath = path.join(cjScripts.userscriptsDir, scriptMeta.filename)
          try {
            fs.writeFileSync(destPath, body, 'utf-8')
            console.log('[CJ Scripts] Saved:', scriptMeta.filename)
            resolve(true)
          } catch (e) {
            console.warn('[CJ Scripts] Failed to save', scriptMeta.filename, ':', e.message)
            resolve(false)
          }
        })
      })

      request.on('error', function (err) {
        clearTimeout(timeout)
        console.warn('[CJ Scripts] Download error for', scriptMeta.filename, ':', err.message)
        resolve(false)
      })

      request.end()
    })
  },

  loadCachedManifest: function () {
    try {
      if (fs.existsSync(cjScripts.manifestCachePath)) {
        return JSON.parse(fs.readFileSync(cjScripts.manifestCachePath, 'utf-8'))
      }
    } catch (e) {
      // ignore
    }
    return null
  },

  getInstalledScripts: function () {
    try {
      if (!fs.existsSync(cjScripts.userscriptsDir)) return []
      return fs.readdirSync(cjScripts.userscriptsDir)
        .filter(function (f) { return f.endsWith('.js') })
        .map(function (filename) {
          var filePath = path.join(cjScripts.userscriptsDir, filename)
          var stat = fs.statSync(filePath)
          return { filename: filename, size: stat.size, mtime: stat.mtime.toISOString() }
        })
    } catch (e) {
      return []
    }
  }
}

module.exports = cjScripts
