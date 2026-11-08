"""Publish metadata only after a full anonymous image download succeeds."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def main(tag, output):
    if not re.fullmatch(r'9\.0\.0-sp1-[0-9a-f]{40}-r[1-9][0-9]*-a[1-9][0-9]*', tag):
        raise ValueError('Immutable console version/source/run/attempt required')
    repository = 'ghcr.io/super-protocol/skyline-console'
    raw = subprocess.check_output(['skopeo', 'inspect', '--raw', 'docker://' + repository + ':' + tag])
    digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
    manifest = json.loads(raw)
    reference = repository + '@' + digest
    config = subprocess.check_output(['skopeo', 'inspect', '--no-creds', '--config', 'docker://' + reference])
    if 'sha256:' + hashlib.sha256(config).hexdigest() != manifest['config']['digest']:
        # Some skopeo versions pretty-print --config. Check original bytes from
        # the anonymous full copy below instead of hashing reformatted JSON.
        config = None
    with tempfile.TemporaryDirectory(prefix='anonymous-console-') as temporary:
        subprocess.run(['skopeo', 'copy', '--src-no-creds', '--preserve-digests',
                        'docker://' + reference, 'dir:' + temporary], check=True)
        actual_manifest = (Path(temporary) / 'manifest.json').read_bytes()
        actual_config = (Path(temporary) / manifest['config']['digest'].split(':')[1]).read_bytes()
        if ('sha256:' + hashlib.sha256(actual_manifest).hexdigest() != digest
                or 'sha256:' + hashlib.sha256(actual_config).hexdigest() != manifest['config']['digest']):
            raise ValueError('Anonymous image identity mismatch')
        image = json.loads(actual_config)
        if image['os'] != 'linux' or image['architecture'] != 'amd64':
            raise ValueError('Linux/amd64 release required')
        for layer in manifest['layers']:
            path = Path(temporary) / layer['digest'].split(':')[1]
            with path.open('rb') as stream:
                if 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest() != layer['digest']:
                    raise ValueError('Anonymous image layer checksum mismatch')
    output = Path(output)
    files = {name: hashlib.sha256((output / name).read_bytes()).hexdigest()
             for name in ('console-manifest.json', 'nginx.conf.j2')}
    console = json.loads((output / 'console-manifest.json').read_bytes())
    if console['source_commit'] != os.environ['GITHUB_SHA']:
        raise ValueError('Console source differs from the publishing commit')
    descriptor = {
        'schema_version': 1, 'capability': 'prebuilt-openstack-images-v1',
        'component': 'skyline-console', 'version': tag,
        'source_commit': console['source_commit'], 'kolla_revision': console['kolla_revision'],
        'ci_run': os.environ['GITHUB_RUN_ID'], 'ci_attempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'image': {'reference': reference, 'config_id': manifest['config']['digest'],
                  'platform': 'linux/amd64'},
        'files_sha256': files, 'anonymous_download_verified': True,
    }
    (output / 'console-component.json').write_text(json.dumps(descriptor, indent=2) + '\n')
    hashes = '\n'.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name
                       for p in sorted(output.iterdir()) if p.is_file())
    (output / 'SHA256SUMS').write_text(hashes + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    main(args.tag, args.output)
