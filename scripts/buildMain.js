const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const outFile = path.resolve(__dirname, '../main.build.js')

/**
 * @correction #0404#2 Pre-build consistency check.
 * Warn if CJ files in min/ diverge from cj-custom/ (source of truth).
 */
function checkCjConsistency () {
  var cjCustomDir = path.resolve(__dirname, '../../cj-custom')
  var minDir = path.resolve(__dirname, '..')
  if (!fs.existsSync(cjCustomDir)) return
  var cjFiles = ['main/cjStealth.js', 'main/cjAutomate.js', 'main/viewManager.js', 'main/cjAuth.js', 'main/cjConfig.js', 'main/main.js']
  var drifted = []
  cjFiles.forEach(function (f) {
    var src = path.join(cjCustomDir, f)
    var dst = path.join(minDir, f)
    if (!fs.existsSync(src) || !fs.existsSync(dst)) return
    try {
      var srcHash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
      var dstHash = crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex')
      if (srcHash !== dstHash) drifted.push(f)
    } catch (e) { /* ignore */ }
  })
  if (drifted.length > 0) {
    console.warn('\n  ⚠️  CJ files out of sync (cj-custom/ ≠ min/):')
    drifted.forEach(function (f) { console.warn('    → ' + f) })
    console.warn('  Run "npm run patch" or "npm run sync-back" to fix.\n')
  }
}

const modules = [
  'dist/localization.build.js',
  'main/windowManagement.js',
  'js/util/keyMap.js',
  'main/menu.js',
  'main/touchbar.js',
  'main/registryConfig.js',
  'js/util/settings/settingsMain.js',
  'main/cjConfig.js',
  'main/cjAuth.js',
  'main/cjTracker.js',
  'main/cjUpdater.js',
  'main/cjScripts.js',
  'main/cjOsInput.js',
  'main/cjAutomationAssistant.js',
  'main/cjStealth.js',
  'main/cjScreenRecorder.js',
  'main/cjEnvSync.js',
  'main/cjAutomate.js',
  'main/main.js',
  'main/minInternalProtocol.js',
  'main/filtering.js',
  'main/viewManager.js',
  'main/download.js',
  'main/UASwitcher.js',
  'main/permissionManager.js',
  'main/prompt.js',
  'main/remoteMenu.js',
  'main/remoteActions.js',
  'main/keychainService.js',
  'js/util/proxy.js',
  'main/themeMain.js'
]

function buildMain () {
  checkCjConsistency()
  require('./buildLocalization.js')()

  /* concatenate modules */
  let output = ''
  modules.forEach(function (script) {
    output += fs.readFileSync(path.resolve(__dirname, '../', script)) + ';\n'
  })

  fs.writeFileSync(outFile, output, 'utf-8')
}

if (module.parent) {
  module.exports = buildMain
} else {
  buildMain()
}
