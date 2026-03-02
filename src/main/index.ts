import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSwitchHandlers } from './switch-handlers'
import { registerIpcHandlers } from './ipc'
import { createTray } from './tray'
import {
  startCronHooks,
  stopCronHooks,
  startBackgroundCrons,
  stopAllBackgroundCrons
} from './cron-scheduler'
import { getAllActiveProfileIds, listProfiles } from './storage'
import { ensureHookDirs, provisionBuiltinHooks } from './hook-storage'
import { initHookRunner, shutdownHookRunner } from './hook-executor'
import { runMigrations } from './migration'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 480,
    minHeight: 600,
    title: 'Xoay Config',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.xoay-config')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Provision hook directories and built-in hooks
  ensureHookDirs()
  provisionBuiltinHooks()

  // Start the persistent hook runner process
  initHookRunner()

  // Run data migrations (must happen before IPC handlers / tray)
  runMigrations()

  // Register IPC handlers
  registerIpcHandlers()
  registerSwitchHandlers()

  // Create system tray
  createTray()

  createWindow()

  // Start cron hooks for all active profiles across categories
  const activeIds = getAllActiveProfileIds()
  for (const profileId of Object.values(activeIds)) {
    if (profileId) {
      startCronHooks(profileId)
    }
  }

  // Start background cron hooks for ALL profiles (regardless of active state)
  const allProfiles = listProfiles()
  for (const profile of allProfiles) {
    startBackgroundCrons(profile.id)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Stop cron hooks and hook runner before app quits
app.on('before-quit', () => {
  stopCronHooks()
  stopAllBackgroundCrons()
  shutdownHookRunner()
})
