var regedit = require('regedit')

var installPath = process.execPath
var appId = 'CJBrowser'

var keysToCreate = [
  'HKCU\\Software\\Classes\\' + appId,
  'HKCU\\Software\\Classes\\' + appId + '\\Application',
  'HKCU\\Software\\Classes\\' + appId + '\\DefaulIcon',
  'HKCU\\Software\\Classes\\' + appId + '\\shell\\open\\command',
  'HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities\\FileAssociations',
  'HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities\\StartMenu',
  'HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities\\URLAssociations',
  'HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\DefaultIcon',
  'HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\InstallInfo',
  'HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\shell\\open\\command'
]

var registryConfig = {
  'HKCU\\Software\\RegisteredApplications': {
    CJBrowser: {
      value: 'Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Classes\\' + appId]: {
    default: {
      value: 'CJBrowser Document',
      type: 'REG_DEFAULT'
    }
  },
  ['HKCU\\Software\\Classes\\' + appId + '\\Application']: {
    ApplicationIcon: {
      value: installPath + ',0',
      type: 'REG_SZ'
    },
    ApplicationName: {
      value: 'CJBrowser',
      type: 'REG_SZ'
    },
    AppUserModelId: {
      value: 'CJBrowser',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Classes\\' + appId + '\\DefaulIcon']: {
    ApplicationIcon: {
      value: installPath + ',0',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Classes\\' + appId + '\\shell\\open\\command']: {
    default: {
      value: '"' + installPath + '" "%1"',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Classes\\.htm\\OpenWithProgIds': {
    CJBrowser: {
      value: 'Empty',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\.html\\OpenWithProgIds': {
    CJBrowser: {
      value: 'Empty',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities\\FileAssociations']: {
    '.htm': {
      value: 'CJBrowser',
      type: 'REG_SZ'
    },
    '.html': {
      value: 'CJBrowser',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities\\StartMenu']: {
    StartMenuInternet: {
      value: 'CJBrowser',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\Capabilities\\URLAssociations']: {
    http: {
      value: 'CJBrowser',
      type: 'REG_SZ'
    },
    https: {
      value: 'CJBrowser',
      type: 'REG_SZ'
    }
  },
  ['HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\DefaultIcon']: {
    default: {
      value: installPath + ',0',
      type: 'REG_DEFAULT'
    }
  },
  ['HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\InstallInfo']: {
    IconsVisible: {
      value: 1,
      type: 'REG_DWORD'
    }
  },
  ['HKCU\\Software\\Clients\\StartMenuInternet\\' + appId + '\\shell\\open\\command']: {
    default: {
      value: installPath,
      type: 'REG_DEFAULT'
    }
  }
}

var registryInstaller = {
  install: function () {
    return new Promise(function (resolve, reject) {
      regedit.createKey(keysToCreate, function () {
        regedit.putValue(registryConfig, function (err) {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    })
  },
  uninstall: function () {
    return new Promise(function (resolve, reject) {
      regedit.deleteKey(keysToCreate, function (err) {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
}
