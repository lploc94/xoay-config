import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import * as path from 'path'
import { fileURLToPath } from 'url'
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
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Security: Only allow safe URL schemes
    const url = details.url
    const allowedSchemes = ['https:', 'http:', 'mailto:']
    try {
      const parsed = new URL(url)
      if (allowedSchemes.includes(parsed.protocol)) {
        shell.openExternal(url)
      } else {
        console.warn(`[Security] Blocked URL with unsafe scheme: ${parsed.protocol}`)
      }
    } catch {
      console.warn(`[Security] Blocked invalid URL: ${url}`)
    }
    return { action: 'deny' }
  })

  // Security: Prevent renderer from navigating main window to remote content
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url)

      // Allow file:// protocol only for app-owned renderer files
      if (parsed.protocol === 'file:') {
        // Block UNC paths (file://host/path)
        if (parsed.host) {
          event.preventDefault()
          console.warn(`[Security] Blocked UNC file path: ${url}`)
          return
        }

        // Convert file URL to path and check if it's within renderer directory
        try {
          const filePath = fileURLToPath(url)
          const rendererDir = path.normalize(path.join(__dirname, '../renderer'))
          const normalizedPath = path.normalize(filePath)

          // Only allow files within the renderer directory
          if (
            normalizedPath.startsWith(rendererDir + path.sep) ||
            normalizedPath === rendererDir
          ) {
            return // Allow navigation to app's own renderer files
          }

          event.preventDefault()
          console.warn(`[Security] Blocked file navigation outside renderer dir: ${url}`)
        } catch {
          event.preventDefault()
          console.warn(`[Security] Blocked invalid file URL: ${url}`)
        }
        return
      }

      // In development, allow the dev server origin
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const devOrigin = new URL(process.env['ELECTRON_RENDERER_URL']).origin
        if (parsed.origin === devOrigin) {
          return // Allow navigation within dev server
        }
      }

      // Block all other protocols - open externally if safe
      event.preventDefault()

      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url)
        console.log(`[Security] Opened external URL in browser: ${url}`)
      } else {
        console.warn(`[Security] Blocked navigation to unsafe URL: ${url}`)
      }
    } catch {
      event.preventDefault()
      console.warn(`[Security] Blocked navigation to invalid URL: ${url}`)
    }
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
      startCronHooks(profileId, { trigger: 'startup' })
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
