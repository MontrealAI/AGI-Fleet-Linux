#!/usr/bin/env python3
"""Load Ubuntu's packaged Bubblewrap policy on disposable qualification VMs."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess


def require(value, message):
    if not value:
        raise RuntimeError(message)


def main():
    require(platform.system() == 'Linux' and os.geteuid() == 0
            and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('GITHUB_REPOSITORY') == 'MontrealAI/AGI-Fleet-Linux',
            'This provisioner is restricted to disposable GitHub-hosted qualification VMs.')
    release = Path('/etc/os-release').read_text()
    require('ID=ubuntu\n' in release and 'VERSION_ID="24.04"' in release,
            'The AppArmor qualification provisioner targets Ubuntu 24.04 only.')
    sysctls = [Path('/proc/sys/kernel') / name for name in
               ('apparmor_restrict_unprivileged_userns', 'apparmor_restrict_unprivileged_unconfined')]
    before = {str(p): p.read_text().strip() for p in sysctls if p.exists()}
    profile = Path('/usr/share/apparmor/extra-profiles/bwrap-userns-restrict')
    require(profile.is_file() and not profile.is_symlink(), 'Install the distribution apparmor-profiles package.')
    st = profile.stat()
    require(st.st_uid == 0 and not st.st_mode & 0o022, 'The packaged policy must be root-owned and not writable by other users.')
    owner = subprocess.check_output(['dpkg-query', '-S', str(profile)], text=True).strip()
    require(owner.split(':', 1)[0] in ('apparmor', 'apparmor-profiles'), 'Unexpected policy package owner.')
    raw = profile.read_bytes()
    require(b'unpriv_bwrap' in raw and b'deny capability' in raw
            and b'flags=(unconfined)' not in raw, 'The child capability-denying policy is required.')
    subprocess.run(['apparmor_parser', '-r', str(profile)], check=True)
    after = {str(p): p.read_text().strip() for p in sysctls if p.exists()}
    require(before == after, 'Namespace restrictions must remain unchanged.')
    print(json.dumps({'classification': 'disposable-runner-prerequisite', 'profile': str(profile),
                      'packageOwner': owner, 'profileSHA256': hashlib.sha256(raw).hexdigest(),
                      'namespaceRestrictionsBefore': before, 'namespaceRestrictionsAfter': after,
                      'scope': 'Bubblewrap setup; executed children retain capability denial',
                      'nativeAcceptance': 'NOT_YET_RUN', 'operatorInstallation': False}, indent=2))


if __name__ == '__main__':
    main()
