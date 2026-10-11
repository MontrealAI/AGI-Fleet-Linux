'use strict';
(() => {
  const platform = document.documentElement.dataset.platform === 'macos' ? 'macos' : 'linux';
  const mac = platform === 'macos';
  const supportedOS = mac ? 'macos' : 'ubuntu';
  const storageKey = mac ? 'agi-fleet-macos-onboarding-v1' : 'agi-fleet-onboarding-v1';
  const french = document.documentElement.lang === 'fr';
  const copy = french ? {
    start: 'Choisissez ce que vous voulez faire.',
    progress: (current, total) => `Étape ${current} sur ${total}`,
    saved: 'Vos choix sont enregistrés uniquement dans ce navigateur. Aucun compte nécessaire.',
    restored: 'Vos choix précédents ont été retrouvés sur cet appareil.',
    unavailable: 'Ce navigateur ne peut pas enregistrer vos choix. Vous pouvez continuer normalement.',
    cleared: 'Votre parcours a été effacé. Votre préférence de taille de texte est conservée.',
    copied: 'Plan copié. Vous pouvez le coller dans un document ou un message destiné à la personne qui vous aide.',
    copyFailed: 'La copie automatique est indisponible. Le plan ci-dessous est sélectionné : utilisez Copier dans votre navigateur ou Ctrl+C (Commande+C sur Mac).',
    planHeading: 'AGI Fleet Linux — plan de préparation',
    planReminder: 'Lisez le guide avec votre administrateur avant de modifier l’ordinateur. Gardez le financement et les travaux rémunérés désactivés jusqu’à la fin de la qualification.',
    guideLabel: 'Guide d’installation',
    releaseLabel: 'Version et sommes de contrôle',
    downloadLabel: 'ZIP Fleet complet',
    worker: 'Votre parcours : préparer un ordinateur',
    hire: 'Votre parcours : faire réaliser un travail',
    explore: 'Votre parcours : découvrir le fonctionnement',
    agent: 'Agent · réaliser le travail',
    node: 'Node · vérifier le travail',
    agentTitle: 'Votre plan pour un Agent.',
    nodeTitle: 'Votre plan pour un Node.',
    agentLogin: 'Suivez les connexions séparées Creator, Checker et Reviewer indiquées dans le guide.',
    nodeLogin: 'Suivez les connexions séparées Checker et Reviewer indiquées dans le guide. Dans les commandes, utilisez packages/AGI_Node à la place de packages/AGI_Agent.',
    unsureTitle: 'Vérifions d’abord votre ordinateur.',
    otherTitle: 'Prévoyez un ordinateur Ubuntu compatible.',
    unsureText: 'Sur l’ordinateur prévu pour Fleet, vérifiez le nom et la version du système : sur Ubuntu ou Windows, ouvrez Paramètres → Système → À propos; sur Mac, menu Apple → À propos de ce Mac. Revenez ensuite au choix de l’ordinateur. Fleet nécessite Ubuntu Desktop 24.04 LTS; Pour un Mac M1 ou M2, utilisez le guide Mac distinct ci-dessous. Windows ne fait pas partie de cette version Linux.',
    otherText: 'Cette version vise un ordinateur dédié avec Ubuntu Desktop 24.04 LTS et un bureau GNOME, sur x86-64 ou ARM64. Windows, macOS, WSL et les autres versions de Linux ne font pas partie de cette qualification.'
  } : {
    start: 'Choose what you want to do.',
    progress: (current, total) => `Step ${current} of ${total}`,
    saved: 'Your choices are saved only in this browser. No account needed.',
    restored: 'Your earlier choices were found on this device.',
    unavailable: 'This browser cannot save your choices. You can still continue normally.',
    cleared: 'Your route has been cleared. Your text-size preference has been kept.',
    copied: 'Plan copied. Paste it into a document or a message for the person helping you.',
    copyFailed: 'Automatic copying is unavailable. The plan below is selected: use your browser’s Copy command or Ctrl+C (Command+C on Mac).',
    planHeading: 'AGI Fleet Linux — preparation plan',
    planReminder: 'Read the guide with your administrator before changing the computer. Keep funding and paid work off until qualification is complete.',
    guideLabel: 'Installation guide',
    releaseLabel: 'Release and checksums',
    downloadLabel: 'Complete Fleet ZIP',
    worker: 'Your path: set up a computer',
    hire: 'Your path: get work done',
    explore: 'Your path: understand how it works',
    agent: 'Agent · create the work',
    node: 'Node · review the work',
    agentTitle: 'Your plan for an Agent.',
    nodeTitle: 'Your plan for a Node.',
    agentLogin: 'Follow the separate Creator, Checker and Reviewer sign-ins described in the guide.',
    nodeLogin: 'Follow the separate Checker and Reviewer sign-ins described in the guide. In its commands, use packages/AGI_Node in place of packages/AGI_Agent.',
    unsureTitle: 'Let’s check your computer first.',
    otherTitle: 'Plan for a compatible Ubuntu computer.',
    unsureText: 'On the computer you plan to use, check the system name and version: on Ubuntu or Windows, open Settings → System → About; on a Mac, use Apple menu → About This Mac. Then return to the computer choices. Fleet needs Ubuntu Desktop 24.04 LTS; For a Mac with an M1 or M2 chip, use the separate Mac guide linked below. Windows is outside this Linux release.',
    otherText: 'This release targets a dedicated computer with Ubuntu Desktop 24.04 LTS and a GNOME desktop, on x86-64 or ARM64. Windows, macOS, WSL and other Linux versions are outside this qualification target.'
  };
  if (mac) Object.assign(copy, french ? {
    planHeading: 'AGI Fleet pour Mac — plan de préparation',
    nodeLogin: 'Suivez les connexions séparées Checker et Reviewer du guide. Utilisez le dossier du rôle AGI_Node, et non celui de AGI_Agent.',
    unsureTitle: 'Vérifions d’abord votre Mac.',
    otherTitle: 'Trouvons la bonne version pour votre ordinateur.',
    unsureText: 'Menu Apple → À propos de ce Mac : relevez la puce, la mémoire et la version de macOS. Ce guide vise les Mac M1 et M2 sous macOS 15 ou version ultérieure. Revenez ensuite au choix de l’ordinateur.',
    otherText: 'Cette archive est native pour Apple silicon M1 et M2 sous macOS 15 ou version ultérieure. Un Mac Intel ne convient pas à cette archive; le guide Linux concerne un ordinateur Ubuntu distinct. Consultez les exigences avec votre aide avant de modifier votre ordinateur.'
  } : {
    planHeading: 'AGI Fleet for Mac — preparation plan',
    nodeLogin: 'Follow the separate Checker and Reviewer sign-ins in the guide. Use the AGI_Node role folder, not the AGI_Agent folder.',
    unsureTitle: 'Let’s check your Mac first.',
    otherTitle: 'Find the right version for your computer.',
    unsureText: 'Choose Apple menu → About This Mac and check the chip, memory and macOS version. This guide targets M1 and M2 Macs on macOS 15 or newer. Then return to the computer choices.',
    otherText: 'This archive runs natively on Apple silicon M1 and M2 with macOS 15 or newer. An Intel Mac cannot use this archive; the Linux guide is for a separate Ubuntu computer. Review the requirements with your helper before changing your computer.'
  });
  const panels = [...document.querySelectorAll('[data-panel]')];
  const knownPanels = new Set(panels.map(panel => panel.id));
  if (!panels.length) return;
  const blankState = largeText => ({path: '', os: '', role: '', panel: 'welcome', largeText});
  const validatedState = value => ({
    path: ['worker', 'hire', 'explore'].includes(value?.path) ? value.path : '',
    os: [supportedOS, 'other', 'unsure'].includes(value?.os) ? value.os : '',
    role: ['agent', 'node'].includes(value?.role) ? value.role : '',
    panel: knownPanels.has(value?.panel) ? value.panel : 'welcome',
    largeText: value?.largeText === true
  });
  let state = blankState(false);
  let canSave = true;
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && saved.version === 1) {
      state = validatedState(saved);
      restored = Boolean(state.path || state.largeText);
    }
  } catch { canSave = false; }
  const status = document.getElementById('save-status');
  const textSize = document.getElementById('text-size');
  const journeyLabel = document.getElementById('journey-label');
  const progress = document.getElementById('progress');
  const stepAnnouncement = document.getElementById('step-announcement');
  const copyButton = document.getElementById('copy-plan');
  const copyStatus = document.getElementById('copy-status');
  const copyText = document.getElementById('plan-copy-text');
  const epochKey = storageKey + '-history-epoch';
  const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let epoch = newId();
  let epochStored = false;
  try {
    const stored = sessionStorage.getItem(epochKey);
    if (typeof stored === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(stored)) epoch = stored;
    else sessionStorage.setItem(epochKey, epoch);
    epochStored = true;
  } catch { /* Navigation still works when session storage is unavailable. */ }
  let lastLocation = '';
  let focusRevision = 0;
  let focusTimer = null;
  let focusFrame = null;
  function cancelPendingFocus() {
    focusRevision += 1;
    if (focusTimer !== null) clearTimeout(focusTimer);
    if (focusFrame !== null) cancelAnimationFrame(focusFrame);
    focusTimer = null;
    focusFrame = null;
  }
  const route = () => ({path: state.path, os: state.os, role: state.role, panel: state.panel});
  const isGuideEntry = value => value?.agiFleetGuide === 1 && (value.platform || 'linux') === platform;
  const isCurrentEntry = value => isGuideEntry(value) && value.epoch === epoch && value.route && typeof value.route === 'object';
  const locationKey = () => location.href + '|' + (history.state?.entry || '');
  function refreshEpoch() {
    if (!epochStored) return false;
    try {
      const stored = sessionStorage.getItem(epochKey);
      if (stored && stored !== epoch) { epoch = stored; return true; }
    } catch { epochStored = false; }
    return false;
  }
  function recordHistory(mode, keepHash = false) {
    const nextRoute = route();
    const hash = keepHash ? location.hash : `#${state.panel}`;
    const current = history.state;
    const sameRoute = isCurrentEntry(current) && JSON.stringify(validatedState(current.route)) === JSON.stringify(validatedState(nextRoute));
    if (mode === 'push' && sameRoute && location.hash === hash) { lastLocation = locationKey(); return; }
    const entry = {agiFleetGuide: 1, platform, epoch, entry: newId(), route: nextRoute};
    try { history[mode === 'push' ? 'pushState' : 'replaceState'](entry, '', location.pathname + location.search + hash); }
    catch { /* The guide remains usable if browser history is unavailable. */ }
    lastLocation = locationKey();
  }
  const normalise = panel => {
    if (panel === 'role' && state.os !== supportedOS) return 'computer';
    if (panel === 'plan' && (state.os !== supportedOS || !state.role)) return state.os === supportedOS ? 'role' : 'computer';
    if (panel === 'device' && !['other', 'unsure'].includes(state.os)) state.os = 'unsure';
    return knownPanels.has(panel) ? panel : 'welcome';
  };
  function persist() {
    try {
      if (!state.path && !state.os && !state.role) {
        if (state.largeText) localStorage.setItem(storageKey, JSON.stringify({version: 1, largeText: true}));
        else localStorage.removeItem(storageKey);
      } else localStorage.setItem(storageKey, JSON.stringify({version: 1, ...state}));
      canSave = true;
    }
    catch { canSave = false; }
    status.textContent = canSave ? copy.saved : copy.unavailable;
  }
  function setTextSize() {
    document.documentElement.classList.toggle('large-text', state.largeText);
    textSize.setAttribute('aria-pressed', String(state.largeText));
  }
  function show(panel, {focus = true, deferFocus = false, save = true, historyMode = 'push', keepHash = false} = {}) {
    cancelPendingFocus();
    state.panel = normalise(panel);
    if (['computer', 'role', 'plan', 'device'].includes(state.panel)) state.path = 'worker';
    if (['hire', 'explore'].includes(state.panel)) state.path = state.panel;
    if (state.panel === 'welcome') state.path = '';
    panels.forEach(section => { section.hidden = section.id !== state.panel; });
    const active = document.getElementById(state.panel);
    if (mac) document.getElementById('installation-guide').href = `install-mac${french ? '-fr' : ''}.html?role=${state.role || 'agent'}`;
    const workerStep = ({welcome: 1, computer: 2, device: 2, role: 3, plan: 4})[state.panel];
    progress.hidden = !workerStep || state.panel === 'welcome';
    [...progress.children].forEach((item, index) => {
      item.classList.toggle('is-complete', index + 1 < workerStep);
      if (index + 1 === workerStep) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    journeyLabel.textContent = state.panel === 'welcome' ? copy.start : copy[state.path];
    stepAnnouncement.textContent = state.panel === 'welcome' ? '' : copy.progress(workerStep || 2, workerStep ? 4 : 2);
    document.getElementById('plan-title').textContent = state.role === 'node' ? copy.nodeTitle : copy.agentTitle;
    document.getElementById('plan-role').textContent = state.role === 'node' ? copy.node : copy.agent;
    document.getElementById('role-login').textContent = state.role === 'node' ? copy.nodeLogin : copy.agentLogin;
    document.getElementById('device-title').textContent = state.os === 'other' ? copy.otherTitle : copy.unsureTitle;
    document.getElementById('device-description').textContent = state.os === 'other' ? copy.otherText : copy.unsureText;
    document.getElementById('reset-choices').hidden = false;
    if (copyText) { copyText.hidden = true; copyText.value = ''; }
    if (copyStatus) copyStatus.textContent = '';
    if (save) persist();
    if (historyMode) recordHistory(historyMode, keepHash);
    if (focus) {
      const revision = focusRevision;
      const focusPanel = () => {
        if (revision !== focusRevision || active.hidden || state.panel !== active.id) return;
        active.querySelector('h2').focus({preventScroll: true});
        active.scrollIntoView({block: 'start', behavior: 'auto'});
      };
      if (deferFocus) {
        focusTimer = setTimeout(() => {
          focusTimer = null;
          focusFrame = requestAnimationFrame(() => { focusFrame = null; focusPanel(); });
        }, 0);
      } else focusPanel();
    }
  }
  document.querySelectorAll('[data-go]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.dataset.os) { state.os = link.dataset.os; state.role = ''; }
      if (link.dataset.role) state.role = link.dataset.role;
      show(link.dataset.go);
    });
  });
  document.querySelectorAll('[data-back]').forEach(button => button.addEventListener('click', () => show(button.dataset.back)));
  document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));
  const printDetails = [...document.querySelectorAll('details[data-print-open]')];
  let printStates = null;
  printDetails.forEach(detail => { detail.open = false; });
  window.addEventListener('beforeprint', () => {
    if (!printStates) printStates = printDetails.map(detail => [detail, detail.open]);
    printDetails.forEach(detail => { detail.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (printStates) printStates.forEach(([detail, open]) => { detail.open = open; });
    printStates = null;
  });
  function planText() {
    const text = selector => document.querySelector(selector)?.textContent.trim().replace(/\s+/g, ' ') || '';
    const releaseTitle = text('.release-details strong');
    const releaseStatus = text('.release-details p').replace(releaseTitle, '').trim();
    const summary = [...document.querySelectorAll('#plan .plan-summary .tag')].map(tag => tag.textContent.trim()).join(' · ');
    const lines = [copy.planHeading, summary, releaseTitle, releaseStatus, '', copy.planReminder];
    document.querySelectorAll('#plan .plan-box').forEach(box => {
      lines.push('', box.querySelector('h3')?.textContent.trim() || '');
      box.querySelectorAll('li').forEach(item => lines.push('• ' + item.textContent.trim().replace(/\s+/g, ' ')));
    });
    lines.push('', text('#role-login'));
    for (const [id, label] of [['installation-guide', copy.guideLabel], ['release-link', copy.releaseLabel], ['download-link', copy.downloadLabel]]) {
      const link = document.getElementById(id);
      if (link?.href) lines.push('', `${label}: ${link.href}`);
    }
    return lines.filter((line, index) => line || index > 2).join('\n');
  }
  copyButton?.addEventListener('click', async () => {
    const summary = planText();
    const selectedRoute = JSON.stringify(route());
    copyButton.disabled = true;
    copyStatus.textContent = '';
    copyText.value = summary;
    copyText.hidden = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(summary);
      if (selectedRoute === JSON.stringify(route())) copyStatus.textContent = copy.copied;
    } catch {
      if (selectedRoute !== JSON.stringify(route())) return;
      copyText.hidden = false;
      copyText.focus();
      copyText.select();
      copyStatus.textContent = copy.copyFailed;
    } finally { copyButton.disabled = false; }
  });
  document.getElementById('reset-choices').addEventListener('click', () => {
    state = blankState(state.largeText);
    epoch = newId();
    try { sessionStorage.setItem(epochKey, epoch); epochStored = true; } catch { epochStored = false; }
    try {
      if (state.largeText) localStorage.setItem(storageKey, JSON.stringify({version: 1, largeText: true}));
      else localStorage.removeItem(storageKey);
      canSave = true;
    } catch { canSave = false; }
    setTextSize();
    show('welcome', {save: false, historyMode: 'replace'});
    status.textContent = canSave ? copy.cleared : copy.unavailable;
  });
  textSize.addEventListener('click', () => { state.largeText = !state.largeText; setTextSize(); persist(); });
  document.querySelectorAll('[data-interactive]').forEach(control => { control.hidden = false; });
  setTextSize();
  const requested = location.hash.slice(1);
  if (isGuideEntry(history.state) && !isCurrentEntry(history.state)) state = blankState(state.largeText);
  else if (isCurrentEntry(history.state)) state = {...validatedState(history.state.route), largeText: state.largeText};
  else if (knownPanels.has(requested)) state.panel = requested;
  const keepInitialHash = (!requested && state.panel === 'welcome')
    || (!knownPanels.has(requested) && Boolean(document.getElementById(requested)) && !isGuideEntry(history.state));
  show(state.panel, {focus: false, save: false, historyMode: 'replace', keepHash: keepInitialHash});
  status.textContent = !canSave ? copy.unavailable : restored ? copy.restored : copy.saved;
  function restoreLocation() {
    const epochChanged = refreshEpoch();
    if (!epochChanged && lastLocation === locationKey()) return;
    const entry = history.state;
    const next = location.hash.slice(1);
    if (epochChanged || (isGuideEntry(entry) && !isCurrentEntry(entry))) {
      state = blankState(state.largeText);
      show('welcome', {deferFocus: true, save: false, historyMode: 'replace'});
      return;
    }
    if (isCurrentEntry(entry)) {
      state = {...validatedState(entry.route), largeText: state.largeText};
      show(state.panel, {historyMode: null, focus: knownPanels.has(next) || !next, deferFocus: true});
      if (knownPanels.has(next) && state.panel !== next) recordHistory('replace');
      lastLocation = locationKey();
      return;
    }
    if (knownPanels.has(next)) show(next, {historyMode: 'replace', deferFocus: true});
    else { cancelPendingFocus(); recordHistory('replace', true); }
  }
  window.addEventListener('popstate', restoreLocation);
  window.addEventListener('hashchange', restoreLocation);
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        state.largeText = saved?.largeText === true;
        setTextSize();
      } catch { /* Keep the active text preference if storage cannot be read. */ }
      if (!epochStored) {
        epoch = newId();
        state = blankState(state.largeText);
        show('welcome', {deferFocus: true, save: false, historyMode: 'replace'});
        return;
      }
      lastLocation = '';
      restoreLocation();
    }
  });
})();
