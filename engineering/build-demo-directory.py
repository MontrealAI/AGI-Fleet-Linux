#!/usr/bin/env python3
"""Static bilingual original-demo discovery. No runtime or release qualification."""
import argparse
import html
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
# Directory implementation assets are references, not executable demo journeys.
# Historical SUCCESSOR mirrors retain their separate immutable source inventory.
DIRECTORY_ASSETS = {
    'engineering/browser-tests/tests/demo-directory.spec.js',
    'engineering/build-demo-directory.py',
    'engineering/test-demo-directory.py',
    'website/demo-directory.css',
    'website/demo-sources.json',
    'website/demos-fr.html',
    'website/demos.html',
}
NAMED_EXAMPLE = re.compile(r'(^|[-_.])(demos?|examples?|samples?)([-_.]|$)', re.I)


def named_examples(tracked):
    return sorted(path for path in tracked
                  if path and not path.startswith('successor/history/')
                  and path not in DIRECTORY_ASSETS
                  and any(NAMED_EXAMPLE.search(part) for part in PurePosixPath(path).parts))


FAMILIES = [
('acceptance', ('Check a good and bad delivery', 'Vérifier une bonne et une mauvaise livraison'), ('Offline rule evaluation', 'Évaluation de règles hors ligne'), ('Run actual acceptance rules over two synthetic catalogue deliveries and inspect approve/reject reasons.', 'Appliquez de vraies règles à deux livraisons synthétiques et examinez les raisons d’approbation ou de rejet.'), ('npm --prefix fleet run demo',), ('Formal criteria only. No wallet, network or transaction; passing rules is not general business-quality assurance.', 'Critères formels uniquement. Aucun portefeuille, réseau ou transaction ; les règles ne garantissent pas la qualité commerciale générale.'), 'fleet/tests/demo.mjs', None),
('roles', ('Explore local role dashboards', 'Explorer les tableaux de bord locaux'), ('Local fixture dashboards', 'Tableaux de bord de cas locaux'), ('Inspect synthetic approve, reject and abstain states in the role packages. Shared nested Node sources are implementation copies, not additional capabilities.', 'Examinez les états synthétiques approuvé, rejeté et abstention dans les paquets de rôles. Les sources Node imbriquées sont des copies partagées, pas des capacités supplémentaires.'), ('npm --prefix fleet/packages/AGI_Node run demo',), ('Install the documented locked package prerequisites and use the local URL printed by the command. Demo states are not live contract outcomes.', 'Installez les prérequis verrouillés documentés et utilisez l’adresse locale affichée. Les états de démonstration ne sont pas des résultats réels du contrat.'), 'fleet/packages/AGI_Node/README.md', None),
('local-skills', ('Inspect a local skills report', 'Examiner un rapport de compétences locales'), ('Installed offline preview', 'Aperçu hors ligne installé'), ('Follow a private local installation, then inspect synthetic role tasks: bounded agent computation, evidence commitments and protocol-state review.', 'Suivez une installation locale privée, puis examinez les tâches synthétiques : calcul borné, empreintes de preuves et revue d’état du protocole.'), (), ('Requires the documented isolated local runtime. Public Pages cannot operate your installed applications. Qualification and recovery requirements remain separate.', 'Nécessite l’environnement local isolé documenté. GitHub Pages ne peut pas piloter vos applications installées. Qualification et reprise restent distinctes.'), 'docs/local-skills/START_HERE.md', None),
('successor', ('Build and check a public artifact', 'Produire et vérifier un livrable public'), ('Runs in this browser', 'Fonctionne dans ce navigateur'), ('Use the original SUCCESSOR builder for bounded public input, then inspect its result and checker evidence.', 'Utilisez le générateur SUCCESSOR original pour des entrées publiques bornées, puis examinez le résultat et ses vérifications.'), (), ('Browser algorithms and Manager-specific handoff grants do not imply Alpha/Jobs compatibility, installed-computer execution or settlement approval.', 'Les algorithmes navigateur et autorisations propres à Manager ne prouvent ni compatibilité Alpha/Jobs, ni exécution sur ordinateur installé, ni approbation de règlement.'), 'successor/docs/GUIDE.md', ('successor.html', 'successor-fr.html')),
('computer', ('Understand computer-work previews', 'Comprendre les aperçus de travail informatique'), ('Source/installed runtime prerequisites', 'Prérequis source et environnement installé'), ('Inspect Linux and Mac setup, task fixtures, computer reports and native commissioning inputs before choosing an isolated host journey.', 'Examinez la configuration Linux et Mac, les cas de tâche, rapports et entrées de mise en service avant un parcours sur hôte isolé.'), (), ('Fixtures and source previews are not physical-host qualification. Provider access, consent, budgets, STOP, cleanup and recovery must be checked on the actual host.', 'Les cas et aperçus sources ne qualifient pas un hôte physique. Accès fournisseur, consentement, budgets, STOP, nettoyage et reprise doivent être vérifiés sur l’hôte réel.'), 'workstation/QUICKSTART.md', ('mac.html', 'mac-fr.html')),
('models', ('Inspect capacity and budget assumptions', 'Examiner les hypothèses de capacité et budget'), ('Local model and policy references', 'Références locales de modèles et politiques'), ('Review funding, labor, capacity, admission, recovery and project-economics inputs with the matching package command and guide.', 'Examinez les entrées de financement, travail, capacité, admission, reprise et coûts avec la commande et le guide correspondants.'), (), ('Input assumptions and modeled value are not verified earnings, measured human effort or approval for paid work. Historical examples retain their own scope.', 'Les hypothèses et valeurs simulées ne sont ni revenus vérifiés, ni effort humain mesuré, ni autorisation de travail rémunéré. Les exemples historiques gardent leur portée.'), 'fleet/package.json', None),
]

def render(lang, sources):
    index = 1 if lang == 'fr' else 0
    def t(en, fr): return fr if index else en
    def esc(value): return html.escape(str(value), quote=True)
    def link(path): return '@@REPO@@/blob/@@SOURCE_COMMIT@@/' + path
    cards = []
    for key, title, mode, goal, commands, scope, guide, route in FAMILIES:
        action = f'<a class="button" href="{route[index]}">{t("Open the original tool or guide", "Ouvrir l’outil ou le guide original")}</a>' if route else ''
        launch = '<details><summary>' + t('Supported launch command', 'Commande de lancement') + '</summary><p>' + t('Run from a checkout of this source, using its documented Node version and locked prerequisites. These POSIX-shell commands are local practice only.', 'Depuis une copie de cette source, utilisez la version Node et les prérequis verrouillés documentés. Ces commandes shell POSIX servent à un exercice local.') + '</p><pre>' + esc('\n'.join(commands)) + '</pre></details>' if commands else ''
        paths = ''.join(f'<li><a href="{link(p)}">{esc(p)}</a></li>' for p in sources[key])
        cards.append(f'<article id="{key}"><p class="eyebrow">{esc(mode[index])}</p><h2>{esc(title[index])}</h2><p>{esc(goal[index])}</p><p class="scope">{esc(scope[index])}</p>{action}<p><a href="{link(guide)}">{t("Read the exact-source guide", "Lire le guide de cette source")}</a></p>{launch}<details><summary>{t("All named examples and sources", "Tous les exemples nommés et sources")} ({len(sources[key])})</summary><ul>{paths}</ul></details></article>')
    jump = ''.join(f'<a href="#{f[0]}">{esc(f[1][index])}</a>' for f in FAMILIES)
    return f'''<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>{t('Demos & local practice', 'Démos et exercices locaux')} · AGI Fleet</title><link rel="stylesheet" href="demo-directory.css"></head><body><a class="skip" href="#main">{t('Skip to demos', 'Aller aux démos')}</a><nav><a href="{t('index.html', 'fr.html')}">AGI FLEET</a><a href="{t('demos-fr.html', 'demos.html')}" lang="{t('fr', 'en')}">{t('Français', 'English')}</a></nav><header><p class="eyebrow">{t('EXPLORE / PRACTICE / VERIFY', 'EXPLORER / PRATIQUER / VÉRIFIER')}</p><h1>{t('Know what you can try.', 'Sachez ce que vous pouvez essayer.')}</h1><p>{t('Find the original browser tools, bounded local examples and installation paths. Choose the journey that matches your environment.', 'Retrouvez les outils navigateur originaux, exemples locaux bornés et parcours d’installation. Choisissez selon votre environnement.')}</p><p class="notice">{t('A complete directory is not proof of execution or production readiness. Runtime prerequisites, release qualification and physical-host evidence remain separate.', 'Un répertoire complet ne prouve ni exécution ni disponibilité en production. Prérequis, qualification de version et preuves sur hôte physique restent distincts.')}</p></header><main id="main"><nav class="jump" aria-label="{t('Demo families', 'Familles de démos')}">{jump}</nav><div class="grid">{''.join(cards)}</div></main><footer>{t('Exact source', 'Source exacte')} <a href="@@REPO@@/commit/@@SOURCE_COMMIT@@">@@SOURCE_COMMIT@@</a> · {t('No payment or authority granted by this page.', 'Cette page n’accorde ni paiement ni autorité.')}</footer></body></html>\n'''

def validate_source(path, tracked):
    if not isinstance(path, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', path):
        raise ValueError('Invalid source path')
    parts = PurePosixPath(path)
    candidate = ROOT / path
    if (parts.is_absolute() or '..' in parts.parts or path not in tracked
            or candidate.is_symlink() or not candidate.is_file()
            or not candidate.resolve().is_relative_to(ROOT.resolve())):
        raise ValueError('Source must be a tracked repository-relative file: ' + path)


def generate(check=False):
    sources = json.loads((ROOT / 'website/demo-sources.json').read_text())
    paths = [p for group in sources.values() for p in group]
    if len(set(paths)) != len(paths): raise ValueError('Duplicate source path')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT, text=True).split('\0')
    named = named_examples(tracked)
    if set(named) - set(paths): raise ValueError('Unmapped named examples: ' + repr(set(named)-set(paths)))
    for path in paths + [f[6] for f in FAMILIES]:
        validate_source(path, set(tracked))
    if set(sources) != {f[0] for f in FAMILIES}: raise ValueError('Family mismatch')
    for lang, name in [('en','demos.html'),('fr','demos-fr.html')]:
        output = ROOT/'website'/name
        text = render(lang,sources)
        if check:
            if output.read_text() != text: raise ValueError('Regenerate '+name)
        else: output.write_text(text)
    print(f'Demo directory: {len(FAMILIES)} families, {len(named)} named paths, {len(paths)} source links')

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');generate(parser.parse_args().check)
