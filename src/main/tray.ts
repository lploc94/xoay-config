import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { listProfiles, getActiveProfileId, getProfile, setActiveProfileId } from './storage'
import { switchEngine } from './switch-engine'
import { syncProfile } from './anchor-sync'
import trayIconPath from '../../resources/trayTemplate.png?asset'

let tray: Tray | null = null

/**
 * Create and initialize the system tray.
 * Call this once during app initialization (after app is ready).
 */
export function createTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Xoay Config')

  buildTrayMenu()
}

/**
 * Rebuild the tray context menu.
 * Call this after switching profiles so the checkmark updates.
 */
export function buildTrayMenu(): void {
  if (!tray) return

  const profiles = listProfiles()
  const activeId = getActiveProfileId()

  const profileItems: Electron.MenuItemConstructorOptions[] =
    profiles.length > 0
      ? profiles.map((p) => ({
          label: p.name,
          type: 'checkbox' as const,
          checked: p.id === activeId,
          click: () => switchFromTray(p.id)
        }))
      : [{ label: 'No profiles', enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...profileItems,
    { type: 'separator' },
    {
      label: 'Show Window',
      click: (): void => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.show()
          win.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      }
    }
  ]

  const contextMenu = Menu.buildFromTemplate(template)
  tray.setContextMenu(contextMenu)
}

/**
 * Handle profile switch triggered from tray menu.
 */
async function switchFromTray(profileId: string): Promise<void> {
  const profile = getProfile(profileId)
  if (!profile) return

  // Sync active profile before switching (best-effort — never block switch)
  const activeId = getActiveProfileId()
  if (activeId) {
    try {
      await syncProfile(activeId)
    } catch (err) {
      console.error('Sync before tray switch failed (continuing):', err)
    }
  }

  const result = await switchEngine.switch(profile)
  if (result.success) {
    setActiveProfileId(profile.id)
    // Notify renderer windows so they can refresh state
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('profile:switched', result)
    })
  }

  // Rebuild menu to update checkmarks
  buildTrayMenu()
}
