/**
 * @file buildMacDmg.js
 * @description macOS DMG installer builder for CJBrowser.
 * Creates a DMG disk image with drag-to-Applications layout.
 * Uses electron-builder with DMG target + ad-hoc code signing.
 *
 * Usage: node scripts/buildMacDmg.js [--arch=arm64|x86]
 *
 * Output: dist/app/CJBrowser-v{version}-mac-{arch}.dmg
 *
 * @correction #0403#3 New macOS DMG packaging script.
 * @since v1.1.2
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const builder = require('electron-builder')
const Platform = builder.Platform
const Arch = builder.Arch

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

const packageFile = require('./../package.json')
const version = packageFile.version
const productName = packageFile.productName || 'CJBrowser'

// Parse arch from CLI args, default to current platform arch
var archArg = process.argv.find(function (arg) { return arg.indexOf('--arch=') === 0 })
var archStr = archArg ? archArg.split('=')[1] : (process.arch === 'arm64' ? 'arm64' : 'x86')

function toArch (str) {
  switch (str) {
    case 'x86':
    case 'x64':
      return Arch.x64
    case 'arm64':
      return Arch.arm64
    default:
      return Arch.arm64
  }
}

var targetArch = toArch(archStr)
console.log('[CJ Build] DMG build starting: ' + productName + ' v' + version + ' arch=' + archStr)

// electron-builder afterPack: flip Electron fuses for security
var afterPack = async function (context) {
  var ext = { darwin: '.app', win32: '.exe', linux: [''] }[context.electronPlatformName]
  var executableName = context.packager.appInfo.productFilename
  var electronBinaryPath = path.join(context.appOutDir, executableName + ext)

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  })
}

var buildConfig = {
  files: [
    '**/*',
    '!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}',
    '!**/{appveyor.yml,.travis.yml,circle.yml}',
    '!**/node_modules/*.d.ts',
    '!**/*.map',
    '!**/*.md',
    '!**/._*',
    '!**/icons/source',
    '!dist/app',
    '!**/icons/icon.icns',
    '!localization/',
    '!scripts/',
    '!**/main',
    '!**/node_modules/@types/',
    '!**/node_modules/pdfjs-dist/legacy',
    '!**/node_modules/pdfjs-dist/lib',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}'
  ],
  mac: {
    icon: 'icons/icon.icns',
    target: [
      {
        target: 'dmg',
        arch: [archStr === 'arm64' ? 'arm64' : 'x64']
      }
    ],
    darkModeSupport: true,
    identity: null, // ad-hoc signing (no Apple Developer certificate)
    extendInfo: {
      NSHumanReadableCopyright: 'CJ ' + new Date().getFullYear(),
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'HTML document',
          CFBundleTypeRole: 'Viewer',
          LSItemContentTypes: ['public.html']
        },
        {
          CFBundleTypeName: 'XHTML document',
          CFBundleTypeRole: 'Viewer',
          LSItemContentTypes: ['public.xhtml']
        }
      ],
      NSUserActivityTypes: ['NSUserActivityTypeBrowsingWeb'],
      LSFileQuarantineEnabled: true
    }
  },
  dmg: {
    title: productName + ' ' + version,
    icon: 'icons/icon.icns',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ],
    window: {
      width: 540,
      height: 380
    }
  },
  directories: {
    output: 'dist/app',
    buildResources: 'resources'
  },
  protocols: [
    { name: 'HTTP link', schemes: ['http', 'https'] },
    { name: 'File', schemes: ['file'] }
  ],
  asar: false,
  afterPack: afterPack,
  publish: null,
  npmRebuild: false
}

var target = Platform.MAC.createTarget(['dmg'], targetArch)

builder.build({
  targets: target,
  config: buildConfig
}).then(function (result) {
  console.log('[CJ Build] DMG build complete!')
  result.forEach(function (f) {
    console.log('  Output: ' + f)
    // Rename to our standard naming
    var expectedName = productName + '-v' + version + '-mac-' + archStr + '.dmg'
    var expectedPath = path.join('dist/app', expectedName)
    if (f !== expectedPath && fs.existsSync(f)) {
      try {
        fs.renameSync(f, expectedPath)
        console.log('  Renamed: ' + expectedPath)
      } catch (e) {
        console.log('  (keep original name)')
      }
    }
  })
}).catch(function (err) {
  console.error('[CJ Build] DMG build failed:', err.message)
  process.exit(1)
})
