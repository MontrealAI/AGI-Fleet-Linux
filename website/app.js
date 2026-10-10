'use strict';
(() => {
  const fr = document.documentElement.lang === 'fr';
  const checks = [...document.querySelectorAll('input[name="preflight"]')];
  const checklistStatus = document.getElementById('checklist-status');
  function updateChecklist() {
    const count = checks.filter(input => input.checked).length;
    checklistStatus.textContent = fr ? `${count} vérifications de préparation sur 4 terminées` : `${count} of 4 planning checks complete`;
    if (count === 4) checklistStatus.textContent += fr ? ' — passez au guide complet; la qualification reste à effectuer.' : ' — continue with the full guide; qualification is still required.';
  }
  checks.forEach(input => input.addEventListener('change', updateChecklist));
  updateChecklist();
  const launchCommand = document.getElementById('role-command');
  const initialCommand = launchCommand.textContent;
  const roleButtons = [...document.querySelectorAll('[data-role]')];
  roleButtons.forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.role;
    if (!['Agent', 'Node', 'Moderator', 'Employer', 'Evidence', 'Recovery'].includes(role)) return;
    roleButtons.forEach(item => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    launchCommand.textContent = initialCommand.replace('AGI_Agent/', `AGI_${role}/`);
    document.getElementById('role-title').textContent = `${role.toUpperCase()} / ${fr ? 'COMMANDE DE LANCEMENT' : 'LAUNCH REFERENCE'}`;
    document.getElementById('role-note').textContent = role === 'Evidence'
      ? (fr ? 'Evidence ouvre un profil en lecture seule, sans portefeuille. Lancez-le dans le nouveau compte prévu pour ce rôle, après placement et vérification de la version complète.' : 'Evidence opens a read-only profile without a wallet. Launch from the new account for this role, after the complete release has been placed and verified.')
      : (fr ? 'Exécutez cette commande seulement après placement et vérification de la version complète par l’administrateur. Utilisez la session graphique du nouveau compte signataire; jamais sudo.' : 'Run only after the administrator has placed and verified the complete release. Use the new signer’s desktop login; never use sudo.');
    document.getElementById('role-qualification').textContent = ['Agent', 'Node'].includes(role)
      ? (fr ? 'Agent et Node disposent des outils de qualification du poste de travail. Chaque rôle exige ses propres observations physiques consignées.' : 'Agent and Node include workstation qualification tools. Each role still needs its own recorded physical observations.')
      : (fr ? 'Ce rôle spécialisé ne dispose pas d’outils de poste de travail. Utilisez le parcours propre au rôle et un hôte vierge distinct; Qualify-Linux.sh est réservé à Agent et Node.' : 'This specialist role does not expose workstation tools. Use its role-specific workflow on a separate clean host; Qualify-Linux.sh is provided only for Agent and Node.');
  }));
  let toastTimer;
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copy);
    const status = document.getElementById('copy-status');
    if (!source) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(source.textContent.trim());
      status.textContent = fr ? 'Commande copiée.' : 'Command copied.';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = fr ? 'Copie automatique indisponible. Le texte est sélectionné : copiez-le manuellement.' : 'Automatic copy is unavailable. Text selected — copy it manually.';
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { status.textContent = ''; }, 6000);
  }));
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const search = document.getElementById('resource-search');
  const cards = [...document.querySelectorAll('.resource-card')];
  search.addEventListener('input', () => {
    const terms = normalize(search.value).trim().split(/\s+/).filter(Boolean);
    let count = 0;
    cards.forEach(card => {
      const haystack = normalize(`${card.textContent} ${card.dataset.search || ''}`);
      card.hidden = !terms.every(term => haystack.includes(term));
      if (!card.hidden) count++;
    });
    document.getElementById('no-results').hidden = count !== 0;
    document.getElementById('search-status').textContent = fr ? `${count} guides trouvés` : `${count} guides found`;
  });
})();
