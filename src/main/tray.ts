import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { listProfiles, getActiveProfileId, getProfile, listCategories, store } from './storage'
import type { HookDisplayValue } from '../shared/types'
import { orchestrateSwitch } from './switch-orchestrator'
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
 * Rebuild the tray context menu with category submenus.
 * Each category shows its profiles with a checkmark on the active one.
 */
export function buildTrayMenu(): void {
  if (!tray) return

  const categories = listCategories()
  const categoryItems: Electron.MenuItemConstructorOptions[] = []

  for (const category of categories) {
    const profiles = listProfiles(category.id)
    if (profiles.length === 0) continue

    const activeId = getActiveProfileId(category.id)
    const hookDisplayData =
      (store.get('hookDisplayData') as Record<string, Record<string, HookDisplayValue>>) ?? {}

    const submenu: Electron.MenuItemConstructorOptions[] = profiles.map((p) => {
      let label = p.name
      if (p.id === activeId) {
        const profileDisplay = hookDisplayData[p.id]
        if (profileDisplay) {
          const firstValue = Object.values(profileDisplay)[0]
          if (firstValue?.value) {
            const prefix = firstValue.status === 'warning' || firstValue.status === 'error' ? '⚠ ' : ''
            label = `${p.name} (${prefix}${firstValue.value})`
          }
        }
      }
      return {
        label,
        type: 'checkbox' as const,
        checked: p.id === activeId,
        click: () => switchFromTray(p.id)
      }
    })

    categoryItems.push({
      label: category.name,
      submenu
    })
  }

  // If no categories have profiles, show a placeholder
  if (categoryItems.length === 0) {
    categoryItems.push({ label: 'No profiles', enabled: false })
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...categoryItems,
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

  try {
    const result = await orchestrateSwitch(profileId)
    // Notify renderer windows so they can show SwitchResultDialog with hook results
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('profile:switched', result)
    })
  } catch (err) {
    console.error('Tray switch failed:', err)
  }
}
