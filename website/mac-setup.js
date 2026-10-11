'use strict';
(() => {
  const root = document.documentElement, fr = root.lang === 'fr';
  const steps = [...document.querySelectorAll('[data-setup-step]')];
  const key = `agi-fleet-mac-setup-${root.dataset.release}`;
  const valid = value => ({step: Number.isInteger(value?.step) && value.step >= 0 && value.step < steps.length ? value.step : 0,
    done: Array.isArray(value?.done) ? [...new Set(value.done.filter(n => Number.isInteger(n) && n >= 0 && n < steps.length))] : [],
    role: value?.role === 'node' ? 'node' : 'agent', large: value?.large === true});
  let state = valid(null), canSave = true;
  try { state = valid(JSON.parse(localStorage.getItem(key))); } catch { canSave = false; }
  const requestedRole = new URLSearchParams(location.search).get('role');
  if (['agent', 'node'].includes(requestedRole) && requestedRole !== state.role) state = valid({role: requestedRole, large: state.large});
  const fromHash = () => { const match = /^#step-([1-8])$/.exec(location.hash); return match ? Number(match[1]) - 1 : null; };
  state.step = fromHash() ?? state.step;
  const status = document.getElementById('setup-status');
  const role = document.getElementById('setup-role');
  const size = document.getElementById('setup-size');
  const mark = document.getElementById('setup-mark');
  const navigation = [...document.querySelectorAll('[data-step-link]')];
  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(state)); canSave = true; } catch { canSave = false; }
    status.textContent = canSave
      ? (fr ? 'Progression enregistrée dans ce navigateur uniquement. Vous pouvez revenir plus tard.' : 'Progress is saved only in this browser. You can come back later.')
      : (fr ? 'Enregistrement indisponible. Le guide reste utilisable; imprimez-le pour garder votre place.' : 'Saving is unavailable. You can still use the guide; print it to keep your place.');
  };
  function render(focus = false) {
    root.classList.toggle('large-text', state.large);
    role.value = state.role;
    size.setAttribute('aria-pressed', String(state.large));
    steps.forEach((step, i) => { step.hidden = i !== state.step; });
    document.querySelectorAll('[data-setup-role]').forEach(item => { item.hidden = item.dataset.setupRole !== state.role; });
    navigation.forEach((link, i) => {
      if (i === state.step) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
      link.querySelector('[data-done]').textContent = state.done.includes(i) ? (fr ? ' · coché' : ' · marked done') : '';
    });
    document.getElementById('setup-position').textContent = fr ? `Étape ${state.step + 1} sur ${steps.length}` : `Step ${state.step + 1} of ${steps.length}`;
    document.getElementById('setup-progress').textContent = fr ? `${state.done.length} étapes cochées par vous sur ${steps.length}` : `${state.done.length} of ${steps.length} steps marked done by you`;
    mark.textContent = state.done.includes(state.step) ? (fr ? 'Remettre cette étape à faire' : 'Mark this step as unfinished') : (fr ? 'J’ai terminé cette étape' : 'I’ve finished this step');
    mark.setAttribute('aria-pressed', String(state.done.includes(state.step)));
    document.getElementById('setup-back').disabled = state.step === 0;
    document.getElementById('setup-next').disabled = state.step === steps.length - 1;
    save();
    if (focus) steps[state.step].querySelector('h2').focus();
  }
  function go(index) {
    state.step = Math.max(0, Math.min(steps.length - 1, index));
    try { history.replaceState(null, '', location.pathname + `?role=${state.role}#step-${state.step + 1}`); } catch {}
    render(true);
  }
  navigation.forEach((link, i) => link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); go(i); }));
  document.getElementById('setup-back').addEventListener('click', () => go(state.step - 1));
  document.getElementById('setup-next').addEventListener('click', () => go(state.step + 1));
  mark.addEventListener('click', () => { state.done = state.done.includes(state.step) ? state.done.filter(n => n !== state.step) : [...state.done, state.step]; render(); });
  size.addEventListener('click', () => { state.large = !state.large; render(); });
  role.addEventListener('change', () => { state = valid({role: role.value, large: state.large}); go(0); });
  document.getElementById('setup-print').addEventListener('click', () => window.print());
  document.getElementById('setup-reset').addEventListener('click', () => { state = valid({role: state.role, large: state.large}); go(0); });
  document.querySelectorAll('[data-setup-interactive]').forEach(item => { item.hidden = false; });
  window.addEventListener('hashchange', () => { const step = fromHash(); if (step !== null) { state.step = step; render(true); } });
  render();
})();
