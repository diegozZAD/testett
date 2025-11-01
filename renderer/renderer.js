const state = {
  profiles: [],
  activeId: null
};

const newTabForm = document.getElementById('newTabForm');
const newTabNameInput = document.getElementById('newTabName');
const newTabUrlInput = document.getElementById('newTabUrl');
const tabList = document.getElementById('tabList');
const tabControls = document.getElementById('tabControls');
const emptyState = document.getElementById('emptyState');
const statusArea = document.getElementById('statusArea');
const tabNameInput = document.getElementById('tabNameInput');
const saveNameBtn = document.getElementById('saveNameBtn');
const tabUrlInput = document.getElementById('tabUrlInput');
const navigateBtn = document.getElementById('navigateBtn');
const userAgentInput = document.getElementById('userAgentInput');
const saveUserAgentBtn = document.getElementById('saveUserAgentBtn');
const clearSessionBtn = document.getElementById('clearSessionBtn');
const closeTabBtn = document.getElementById('closeTabBtn');
const headlessNotice = document.getElementById('headlessNotice');

const statusMessages = [];

function pushStatus(message, type = 'info') {
  statusMessages.unshift({ message, type, id: Date.now() });
  if (statusMessages.length > 5) {
    statusMessages.pop();
  }
  renderStatus();
}

function renderStatus() {
  statusArea.innerHTML = '';
  statusMessages.forEach((item) => {
    const div = document.createElement('div');
    div.className = `status ${item.type}`;
    div.textContent = item.message;
    statusArea.appendChild(div);
  });
}

function renderTabList() {
  tabList.innerHTML = '';
  if (!state.profiles.length) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }
  state.profiles.forEach((profile) => {
    const li = document.createElement('li');
    li.className = `tab-item${profile.id === state.activeId ? ' active' : ''}`;
    li.dataset.id = profile.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-item-name';
    nameSpan.textContent = profile.name || 'Sem nome';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'tab-item-url';
    urlSpan.textContent = profile.lastUrl ? profile.lastUrl : 'Sem URL carregada';

    li.appendChild(nameSpan);
    li.appendChild(urlSpan);

    li.addEventListener('click', async () => {
      await setActiveTab(profile.id);
    });

    li.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.electronAPI.showTabContextMenu(profile.id);
    });

    tabList.appendChild(li);
  });
}

function renderControls() {
  const activeProfile = state.profiles.find((profile) => profile.id === state.activeId);
  if (!activeProfile) {
    tabControls.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  tabControls.classList.remove('hidden');
  emptyState.classList.add('hidden');
  tabNameInput.value = activeProfile.name || '';
  tabUrlInput.value = activeProfile.lastUrl || 'https://www.youtube.com';
  userAgentInput.value = activeProfile.userAgent || '';
}

function renderAll() {
  renderTabList();
  renderControls();
}

function updateHeadlessNotice(isHeadless) {
  if (!headlessNotice) return;
  if (isHeadless) {
    headlessNotice.classList.remove('hidden');
  } else {
    headlessNotice.classList.add('hidden');
  }
}

async function setActiveTab(id, { notifyMain = true } = {}) {
  state.activeId = id;
  if (notifyMain && id) {
    await window.electronAPI.activateProfile(id);
  }
  renderAll();
}

async function bootstrap() {
  try {
    const runtime = await window.electronAPI.getRuntimeOptions();
    updateHeadlessNotice(runtime?.headless);
    if (runtime?.headless) {
      pushStatus('Executando em modo headless. O Chromium está sem interface visível.', 'warning');
    }
  } catch (error) {
    console.error('Failed to load runtime options', error);
  }

  const profiles = await window.electronAPI.getProfiles();
  state.profiles = profiles;
  if (profiles.length) {
    await setActiveTab(profiles[0].id);
  } else {
    renderAll();
  }
}

newTabForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = newTabNameInput.value.trim();
  const url = newTabUrlInput.value.trim() || 'https://www.youtube.com';
  const profile = await window.electronAPI.createProfile({ name, url });
  if (!state.profiles.find((item) => item.id === profile.id)) {
    state.profiles = [...state.profiles, profile];
  }
  newTabNameInput.value = '';
  newTabUrlInput.value = 'https://www.youtube.com';
  pushStatus(`Aba ${profile.name} criada.`);
  await setActiveTab(profile.id);
});

saveNameBtn.addEventListener('click', async () => {
  if (!state.activeId) return;
  const name = tabNameInput.value.trim() || 'Sem nome';
  await window.electronAPI.renameProfile({ id: state.activeId, name });
  pushStatus('Nome da aba atualizado.');
});

navigateBtn.addEventListener('click', async () => {
  if (!state.activeId) return;
  const url = tabUrlInput.value.trim();
  if (!url) {
    pushStatus('Informe uma URL válida.', 'error');
    return;
  }
  await window.electronAPI.navigateProfile({ id: state.activeId, url });
  pushStatus('Navegando para a nova URL.');
});

saveUserAgentBtn.addEventListener('click', async () => {
  if (!state.activeId) return;
  const userAgent = userAgentInput.value.trim();
  await window.electronAPI.setProfileUserAgent({ id: state.activeId, userAgent });
  pushStatus('User-Agent atualizado.');
});

clearSessionBtn.addEventListener('click', async () => {
  if (!state.activeId) return;
  await window.electronAPI.clearProfileSession(state.activeId);
  pushStatus('Sessão apagada para esta aba.', 'warning');
});

closeTabBtn.addEventListener('click', async () => {
  if (!state.activeId) return;
  await window.electronAPI.closeProfile(state.activeId);
});

window.electronAPI.onProfilesUpdated((profiles) => {
  state.profiles = profiles;
  if (state.activeId && !profiles.find((profile) => profile.id === state.activeId)) {
    state.activeId = profiles.length ? profiles[0].id : null;
    if (state.activeId) {
      window.electronAPI.activateProfile(state.activeId);
    }
  }
  renderAll();
});

window.electronAPI.onTabError(({ id, message }) => {
  if (id === state.activeId) {
    pushStatus(message, 'error');
  }
});

window.electronAPI.onSessionCleared((id) => {
  if (id === state.activeId) {
    pushStatus('Sessão limpa com sucesso.', 'warning');
  }
});

window.electronAPI.onRuntimeOptions((options) => {
  updateHeadlessNotice(options?.headless);
});

bootstrap();
