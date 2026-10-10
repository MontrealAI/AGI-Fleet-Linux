'use strict';
(() => {
  const storageKey = 'agi-fleet-onboarding-v1';
  const french = document.documentElement.lang === 'fr';
  const copy = french ? {
    start: 'Quelques questions pour trouver votre prochaine étape.',
    progress: (current, total) => `Étape ${current} sur ${total}`,
    saved: 'Vos choix sont enregistrés uniquement dans ce navigateur. Aucun compte nécessaire.',
    restored: 'Vos choix précédents ont été retrouvés sur cet appareil.',
    unavailable: 'Ce navigateur ne peut pas enregistrer vos choix. Vous pouvez continuer normalement.',
    cleared: 'Vos choix ont été effacés. Vous pouvez recommencer.',
    worker: 'Votre parcours : préparer un poste de travail',
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
    unsureText: 'Sur l’ordinateur qui exécutera Fleet, ouvrez Paramètres → Système → À propos. Vérifiez le nom et la version du système. Il faut Ubuntu Desktop 24.04 LTS avec un bureau GNOME, sur x86-64 ou ARM64.',
    otherText: 'Cette version vise un ordinateur dédié avec Ubuntu Desktop 24.04 LTS et un bureau GNOME, sur x86-64 ou ARM64. Windows, macOS, WSL et les autres versions de Linux ne font pas partie de cette qualification.'
  } : {
    start: 'A few simple questions to find your next step.',
    progress: (current, total) => `Step ${current} of ${total}`,
    saved: 'Your choices are saved only in this browser. No account needed.',
    restored: 'Your earlier choices were found on this device.',
    unavailable: 'This browser cannot save your choices. You can still continue normally.',
    cleared: 'Your choices have been cleared. You can start again.',
    worker: 'Your path: set up a workstation',
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
    unsureText: 'On the computer that will run Fleet, open Settings → System → About. Check the operating system name and version. You need Ubuntu Desktop 24.04 LTS with a GNOME desktop, on x86-64 or ARM64.',
    otherText: 'This release targets a dedicated computer with Ubuntu Desktop 24.04 LTS and a GNOME desktop, on x86-64 or ARM64. Windows, macOS, WSL and other Linux versions are outside this qualification target.'
  };
  const panels = [...document.querySelectorAll('[data-panel]')];
  const knownPanels = new Set(panels.map(panel => panel.id));
  if (!panels.length) return;
  let state = { path: '', os: '', role: '', panel: 'welcome', largeText: false };
  let canSave = true;
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && saved.version === 1) {
      state.path = ['worker', 'hire', 'explore'].includes(saved.path) ? saved.path : '';
      state.os = ['ubuntu', 'other', 'unsure'].includes(saved.os) ? saved.os : '';
      state.role = ['agent', 'node'].includes(saved.role) ? saved.role : '';
      state.largeText = saved.largeText === true;
      state.panel = knownPanels.has(saved.panel) ? saved.panel : 'welcome';
      restored = Boolean(state.path || state.largeText);
    }
  } catch { canSave = false; }
  const status = document.getElementById('save-status');
  const textSize = document.getElementById('text-size');
  const journeyLabel = document.getElementById('journey-label');
  const progress = document.getElementById('progress');
  const stepAnnouncement = document.getElementById('step-announcement');
  const normalise = panel => {
    if (panel === 'role' && state.os !== 'ubuntu') return 'computer';
    if (panel === 'plan' && (state.os !== 'ubuntu' || !state.role)) return state.os === 'ubuntu' ? 'role' : 'computer';
    if (panel === 'device' && !['other', 'unsure'].includes(state.os)) state.os = 'unsure';
    return knownPanels.has(panel) ? panel : 'welcome';
  };
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({version: 1, ...state})); canSave = true; }
    catch { canSave = false; }
    status.textContent = canSave ? copy.saved : copy.unavailable;
  }
  function setTextSize() {
    document.documentElement.classList.toggle('large-text', state.largeText);
    textSize.setAttribute('aria-pressed', String(state.largeText));
  }
  function show(panel, focus = true, save = true) {
    state.panel = normalise(panel);
    if (['computer', 'role', 'plan', 'device'].includes(state.panel)) state.path = 'worker';
    if (['hire', 'explore'].includes(state.panel)) state.path = state.panel;
    if (state.panel === 'welcome') state.path = '';
    panels.forEach(section => { section.hidden = section.id !== state.panel; });
    const active = document.getElementById(state.panel);
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
    if (save) persist();
    try { history.replaceState(null, '', `#${state.panel}`); } catch { /* The guide also works when history is unavailable. */ }
    if (focus) active.querySelector('h2').focus({preventScroll: true});
    if (focus) active.scrollIntoView({block: 'start', behavior: 'auto'});
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
  document.getElementById('reset-choices').addEventListener('click', () => {
    state = {path: '', os: '', role: '', panel: 'welcome', largeText: false};
    try { localStorage.removeItem(storageKey); canSave = true; } catch { canSave = false; }
    setTextSize();
    show('welcome', true, false);
    status.textContent = canSave ? copy.cleared : copy.unavailable;
  });
  textSize.addEventListener('click', () => { state.largeText = !state.largeText; setTextSize(); persist(); });
  document.querySelectorAll('[data-interactive]').forEach(control => { control.hidden = false; });
  setTextSize();
  const requested = location.hash.slice(1);
  if (knownPanels.has(requested)) state.panel = requested;
  show(state.panel, false, false);
  status.textContent = !canSave ? copy.unavailable : restored ? copy.restored : copy.saved;
  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    if (knownPanels.has(next)) show(next);
  });
})();
