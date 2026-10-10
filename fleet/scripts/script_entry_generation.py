"""Canonical, byte-preserving generation of executable JavaScript entries."""
import json
from pathlib import Path


def validate_script_bytes(source, label='script'):
    if not isinstance(source, bytes):
        raise TypeError('script source must be bytes')
    if source.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff', b'\x00\x00\xfe\xff')):
        raise ValueError(f'{label}: byte order marks are not allowed')
    position = source.find(b'#!')
    if position > 0 or (position == 0 and source.find(b'#!', 2) >= 0):
        raise ValueError(f'{label}: hashbang is allowed only at byte zero')
    source.decode('utf-8', errors='strict')
    return source


def insert_imports(source, imports):
    """Insert unique single-line imports after a byte-zero hashbang, if present."""
    validate_script_bytes(source)
    imports = tuple(imports)
    for statement in imports:
        if not isinstance(statement, bytes):
            raise TypeError('generated imports must be bytes')
        validate_script_bytes(statement, 'generated import')
        if (not statement.startswith(b'import ') or not statement.endswith(b';')
                or b'\n' in statement or b'\r' in statement or b'#!' in statement):
            raise ValueError('generated imports must be single-line import statements')
    first_newline = source.find(b'\n')
    newline = b'\r\n' if first_newline > 0 and source[first_newline - 1:first_newline] == b'\r' else b'\n'
    existing = set(source.splitlines())
    missing = []
    for statement in imports:
        if statement not in existing:
            missing.append(statement)
            existing.add(statement)
    if not missing:
        return source
    generated = newline.join(missing) + newline
    if not source.startswith(b'#!'):
        return validate_script_bytes(generated + source)
    if first_newline < 0:
        return validate_script_bytes(source + newline + generated)
    boundary = first_newline + 1
    return validate_script_bytes(source[:boundary] + generated + source[boundary:])


def generated_entries(canonical):
    """Return canonical entry bytes keyed by role and destination path."""
    directory = Path(canonical) / 'script-entries'
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('schema') != 'agi-script-entry-templates/v1':
        raise ValueError('unsupported script entry template schema')
    result = {}
    for entry in manifest['entries']:
        template = Path(entry['template'])
        output = Path(entry['output'])
        if (template.is_absolute() or '..' in template.parts or len(template.parts) != 1
                or output.is_absolute() or '..' in output.parts
                or len(output.parts) != 2 or output.parts[0] != 'scripts'
                or output.suffix not in ('.mjs', '.js', '.cjs')):
            raise ValueError('unsafe script entry template or destination path')
        body = (directory / template).read_bytes()
        if not body.startswith(b'#!/usr/bin/env node\n'):
            raise ValueError(f'{template}: canonical template requires a byte-zero Node hashbang')
        content = insert_imports(body, [statement.encode('utf-8') for statement in entry['imports']])
        for role in entry['roles']:
            destinations = result.setdefault(role, {})
            if output.as_posix() in destinations:
                raise ValueError(f'duplicate generated entry: {role}/{output}')
            destinations[output.as_posix()] = content
    return result
