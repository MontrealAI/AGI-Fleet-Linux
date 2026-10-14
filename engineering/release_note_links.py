"""Publish the repository's bounded Markdown guide links at an exact source commit.

Offline Markdown is never modified. Unsupported inline-link syntax is left for
normal Markdown rendering; repository release-note tests cover the actual guide
format. This is a link relocator, not an HTML or Markdown sanitizer.
"""
from pathlib import Path
import re
from urllib.parse import quote, unquote, urlsplit

INLINE = re.compile(r'(?P<before>!?\[[^\]\n]*\]\()(?P<target><[^>\n]+>|[^\s()]+)(?P<after>(?:\s+"[^"\n]*")?\))')
REFERENCE = re.compile(r'^(?P<before> {0,3}\[[^\]\n]+\]:\s*)(?P<target><[^>\n]+>|[^\s]+)(?P<after>.*)$')
CODE = re.compile(r'(`+)(.*?)(?<!`)\1(?!`)', re.DOTALL)


def render_release_note_links(text, *, root, source, repository, commit):
    """Resolve local guide links without changing external URLs or code examples."""
    if not re.fullmatch(r'[0-9a-f]{40}', commit or ''):
        raise ValueError('Release notes require an exact 40-character commit SHA')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository or ''):
        raise ValueError('Invalid repository identity')
    root = Path(root).resolve(strict=True)
    source = (root / source).resolve(strict=True)
    if not source.is_relative_to(root) or not source.is_file():
        raise ValueError('Release-note source must be a file inside the repository')

    def relocate(match):
        target = match['target']
        angled = target.startswith('<') and target.endswith('>')
        value = target[1:-1] if angled else target
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or value.startswith('#'):
            return match[0]
        if value.startswith('/') or '\\' in value or any(ord(c) < 32 for c in value):
            raise ValueError('Unsafe repository-relative release link: ' + value)
        decoded = unquote(parsed.path)
        if '\\' in decoded or any(ord(c) < 32 for c in decoded):
            raise ValueError('Unsafe encoded release link: ' + value)
        destination = (source.parent / decoded).resolve(strict=True) if decoded else source
        if not destination.is_relative_to(root) or not destination.is_file():
            raise ValueError('Release link must name a file inside the repository: ' + value)
        relative = quote(destination.relative_to(root).as_posix(), safe='/')
        host = (f'https://raw.githubusercontent.com/{repository}/{commit}/'
                if match['before'].startswith('!') else f'https://github.com/{repository}/blob/{commit}/')
        result = host + relative
        if parsed.query:
            result += '?' + parsed.query
        if parsed.fragment:
            result += '#' + parsed.fragment
        return match['before'] + ('<' + result + '>' if angled else result) + match['after']

    def prose(text):
        parts = []; position = 0
        for code in CODE.finditer(text):
            parts.append(INLINE.sub(relocate, text[position:code.start()]))
            parts.append(code[0]); position = code.end()
        parts.append(INLINE.sub(relocate, text[position:]))
        return ''.join(parts)

    output = []; fence = None
    for line in text.splitlines(keepends=True):
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if fence:
            output.append(line)
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not marker[2].strip():
                fence = None
        elif marker:
            fence = marker[1]; output.append(line)
        elif line.startswith(('    ', '\t')):
            output.append(line)
        else:
            reference = REFERENCE.match(line.rstrip('\r\n'))
            output.append(relocate(reference) + line[len(reference[0]):] if reference else prose(line))
    return ''.join(output)
