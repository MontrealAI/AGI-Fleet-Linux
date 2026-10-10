#!/usr/bin/env python3
import argparse
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {'index.html', 'fr.html', 'start.html', 'start-fr.html', 'styles.css',
            'app.js', 'onboarding.css', 'onboarding.js', 'favicon.svg', 'release.json'}
ALLOWED = REQUIRED | {'.nojekyll', '404.html'}
PROJECT_PATH = '/AGI-Fleet-Linux/'
REPOSITORY_PATH = '/MontrealAI/AGI-Fleet-Linux/'
SECRET_PATTERNS = (
    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    r'\bgh[pousr]_[A-Za-z0-9]{30,}\b',
    r'\bgithub_pat_[A-Za-z0-9_]{40,}\b',
    r'\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b',
)


class Page(HTMLParser):
    def __init__(self, path, errors):
        super().__init__(convert_charrefs=True)
        self.path, self.errors = path, errors
        self.ids, self.links = set(), []
        self.lang, self.viewport, self.title, self.h1 = None, False, False, 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        identifier = attrs.get('id')
        if identifier:
            if identifier in self.ids:
                self.errors.append(f'{self.path.name}: duplicate id {identifier!r}')
            self.ids.add(identifier)
        if tag == 'html':
            self.lang = attrs.get('lang')
        if tag == 'meta' and attrs.get('name') == 'viewport':
            self.viewport = True
        if tag == 'title':
            self.title = True
        if tag == 'h1':
            self.h1 += 1
        if tag == 'img' and 'alt' not in attrs:
            self.errors.append(f'{self.path.name}: image has no alt attribute')
        if tag in {'base', 'iframe', 'object', 'embed', 'form'}:
            self.errors.append(f'{self.path.name}: unsupported public-site element <{tag}>')
        for attribute in ('href', 'src', 'poster'):
            if attrs.get(attribute):
                asset = attribute in {'src', 'poster'} or (tag == 'link' and bool(
                    set(attrs.get('rel', '').split()) & {'stylesheet', 'icon', 'manifest', 'preload', 'modulepreload'}))
                self.links.append((attrs[attribute], asset))
        for attribute in attrs:
            if attribute.startswith('on'):
                self.errors.append(f'{self.path.name}: inline event handler {attribute}')

    handle_startendtag = handle_starttag


def check(site):
    errors, texts, pages = [], {}, {}
    if site.is_symlink() or not site.is_dir():
        return ['Public site must be a real directory; run engineering/build-website.py first.'], {}
    root = site.resolve()
    for path in sorted(site.rglob('*')):
        relative = path.relative_to(site).as_posix()
        if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
            errors.append(f'{relative}: only regular public files without links are permitted')
            continue
        if relative not in ALLOWED:
            errors.append(f'{relative}: not in the public-file allowlist')
            continue
        if path.stat().st_size > 2_000_000:
            errors.append(f'{relative}: unexpectedly large public file')
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeError:
            errors.append(f'{relative}: public source must be UTF-8')
            continue
        texts[relative] = text
        if re.search(r'@@[A-Z][A-Z0-9_]*@@', text):
            errors.append(f'{relative}: unresolved build placeholder')
        if any(re.search(pattern, text) for pattern in SECRET_PATTERNS):
            errors.append(f'{relative}: possible credential; remove it before publication')
        if path.suffix == '.html':
            page = Page(path, errors)
            page.feed(text)
            page.close()
            pages[relative] = page
            if not page.lang or not page.viewport or not page.title or page.h1 != 1:
                errors.append(f'{relative}: require language, viewport, title and exactly one h1')
    for missing in sorted(REQUIRED - texts.keys()):
        errors.append(f'{missing}: missing public file')

    checked_links = 0

    def link(source, value, asset=False):
        nonlocal checked_links
        checked_links += 1
        parts = urlsplit(value.strip())
        if parts.scheme in {'mailto', 'tel'} and not asset:
            return
        if parts.scheme and parts.scheme != 'https':
            errors.append(f'{source}: unsupported link scheme in {value!r}')
            return
        if parts.netloc and not parts.scheme:
            errors.append(f'{source}: use an explicit HTTPS URL: {value!r}')
            return
        if parts.netloc:
            if asset:
                errors.append(f'{source}: external assets are not permitted: {value!r}')
            if parts.netloc == 'github.com' and parts.path.startswith(REPOSITORY_PATH):
                for prefix in ('blob/main/', 'tree/main/'):
                    base = REPOSITORY_PATH + prefix
                    if parts.path.startswith(base):
                        target = (ROOT / unquote(parts.path[len(base):])).resolve()
                        if not target.is_relative_to(ROOT) or not target.exists():
                            errors.append(f'{source}: repository target does not exist: {value!r}')
            if parts.netloc != 'montrealai.github.io':
                return
            if not parts.path.startswith(PROJECT_PATH):
                return
            local = unquote(parts.path[len(PROJECT_PATH):]) or 'index.html'
        else:
            local = unquote(parts.path)
            if local.startswith(PROJECT_PATH):
                local = local[len(PROJECT_PATH):] or 'index.html'
            elif local.startswith('/'):
                errors.append(f'{source}: root-relative URL loses the project prefix: {value!r}')
                return
            elif not local:
                local = source
        target = (root / local).resolve()
        if not target.is_relative_to(root):
            errors.append(f'{source}: link escapes the public site: {value!r}')
            return
        if target.is_dir():
            target /= 'index.html'
        name = target.relative_to(root).as_posix()
        if not target.is_file():
            errors.append(f'{source}: missing local target: {value!r}')
        elif parts.fragment and name in pages and unquote(parts.fragment) not in pages[name].ids:
            errors.append(f'{source}: missing section target: {value!r}')

    for name, page in pages.items():
        for value, asset in page.links:
            link(name, value, asset=asset)
    for name, text in texts.items():
        if name.endswith('.css'):
            for value in re.findall(r'url\(\s*[\'\"]?([^\'\")]+)[\'\"]?\s*\)', text):
                link(name, value, asset=True)
    if 'release.json' in texts:
        try:
            release = json.loads(texts['release.json'])
            if not isinstance(release, dict):
                errors.append('release.json: expected an object')
            spec = importlib.util.spec_from_file_location('website_build', ROOT / 'engineering/build-website.py')
            builder = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(builder)
            builder.ROOT = ROOT
            expected = builder.read_release()
            tokens = builder.release_tokens(expected)
            if release != expected:
                errors.append('release.json: does not match the selected reviewed release metadata')
            for name in builder.PUBLIC_FILES:
                source = ROOT / 'website' / name
                if texts.get(name) != builder.render(source.read_text(encoding='utf-8'), source.suffix, tokens):
                    errors.append(f'{name}: stale or changed public file; rebuild from the selected release metadata')
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            errors.append('release.json: invalid release metadata: ' + str(error))
    return errors, {'files': len(texts), 'links': checked_links, 'htmlPages': len(pages)}


def main():
    parser = argparse.ArgumentParser(description='Validate the exact public artifact before GitHub Pages upload.')
    parser.add_argument('directory', nargs='?', type=Path, default=ROOT / '_site')
    args = parser.parse_args()
    errors, stats = check(args.directory)
    if errors:
        for error in errors:
            print('ERROR: ' + error, file=sys.stderr)
        return 1
    print(json.dumps({'status': 'PASS', **stats, 'publicDirectory': str(args.directory)}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
