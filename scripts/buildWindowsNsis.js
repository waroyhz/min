/**
 * buildWindowsNsis.js — Build Windows NSIS installer for CJ Browser
 *
 * Produces: dist/app/CJBrowser-v{version}-windows-setup.exe
 * Uses electron-builder's built-in NSIS support (no external tools required).
 *
 * Run: node scripts/buildWindowsNsis.js
 */

const builder = require('electron-builder')
const Platform = builder.Platform
const Arch = builder.Arch
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('path')
const package_json = require('../package.json')

const version = package_json.version

async function buildNsisInstaller () {
  const afterPack = async (context) => {
    const executableName = context.packager.appInfo.productFilename
    const electronBinaryPath = path.join(context.appOutDir, `${executableName}.exe`)
    await flipFuses(electronBinaryPath, {
      version: FuseVersion.V1,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
    })
  }

  const options = {
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
    win: {
      icon: 'icons/icon256.ico',
      // NSIS installer target (x64 only for primary release)
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        }
      ]
    },
    nsis: {
      // One-click installer (standard Windows experience)
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      installerIcon: 'icons/icon256.ico',
      uninstallerIcon: 'icons/icon256.ico',
      installerHeaderIcon: 'icons/icon256.ico',
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'CJBrowser',
      artifactName: 'CJBrowser-v${version}-windows-setup.exe',
      unicode: true
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

  console.log(`Building CJ浏览器 v${version} — Windows NSIS Installer (x64)...`)

  return builder.build({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    config: options
  })
}

buildNsisInstaller()
  .then(function () {
    console.log('✅ NSIS installer built successfully!')
    console.log(`   Output: dist/app/CJBrowser-v${version}-windows-setup.exe`)
  })
  .catch(function (err) {
    console.error('❌ NSIS build failed:', err.message || err)
    process.exit(1)
  })
