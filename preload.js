const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  createProfile: (payload) => ipcRenderer.invoke('create-profile', payload),
  renameProfile: (payload) => ipcRenderer.invoke('rename-profile', payload),
  activateProfile: (id) => ipcRenderer.invoke('activate-profile', id),
  closeProfile: (id) => ipcRenderer.invoke('close-profile', id),
  navigateProfile: (payload) => ipcRenderer.invoke('navigate-profile', payload),
  clearProfileSession: (id) => ipcRenderer.invoke('clear-profile-session', id),
  setProfileUserAgent: (payload) => ipcRenderer.invoke('set-profile-user-agent', payload),
  showTabContextMenu: (id) => ipcRenderer.invoke('show-tab-context-menu', id),
  onProfilesUpdated: (callback) => ipcRenderer.on('profiles-updated', (_event, profiles) => callback(profiles)),
  onTabError: (callback) => ipcRenderer.on('tab-error', (_event, data) => callback(data)),
  onSessionCleared: (callback) => ipcRenderer.on('session-cleared', (_event, id) => callback(id))
});
