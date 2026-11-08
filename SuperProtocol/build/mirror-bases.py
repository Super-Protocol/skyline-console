"""Mirror reviewed bases without changing manifest, config or layer identity."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def run(*args):
    return subprocess.check_output(args)


def inspect(reference, *, anonymous=False):
    flags = ['--no-creds'] if anonymous else []
    raw = run('skopeo', 'inspect', *flags, '--raw', 'docker://' + reference)
    body = json.loads(raw)
    if hashlib.sha256(raw).hexdigest() != reference.rsplit(':', 1)[1]:
        raise ValueError('Registry manifest digest mismatch')
    return body


def main():
    lock = json.loads((Path(__file__).parent / 'component-lock.json').read_bytes())
    for name, item in lock['bases'].items():
        # Subsequent builds use only the immutable mirror. An existing mirror
        # with wrong content is never repaired or replaced automatically.
        cached = subprocess.run(['skopeo', 'inspect', '--raw', 'docker://' + item['mirror']],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if cached.returncode == 0:
            if ('sha256:' + hashlib.sha256(cached.stdout).hexdigest() != item['mirror'].split('@')[1]
                    or json.loads(cached.stdout)['config']['digest'] != item['config_id']):
                raise ValueError('Pinned mirror identity differs')
            continue
        expected = inspect(item['upstream'], anonymous=True)
        if expected['config']['digest'] != item['config_id']:
            raise ValueError('Reviewed base config changed')
        destination = item['mirror'].split('@')[0] + ':base-' + item['mirror'].rsplit(':', 1)[1]
        # Never overwrite an existing publication, even with identical bytes.
        found = subprocess.run(['skopeo', 'inspect', '--raw', 'docker://' + destination],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if found.returncode == 0:
            if json.loads(found.stdout) != expected:
                raise ValueError('Existing base tag has different content; refusing replacement')
        else:
            subprocess.run(['skopeo', 'copy', '--preserve-digests',
                            'docker://' + item['upstream'], 'docker://' + destination], check=True)
        mirrored = inspect(item['mirror'])
        if mirrored != expected:
            raise ValueError('Mirror changed the manifest, config or ordered layers')
        config = json.loads(run('skopeo', 'inspect', '--config', 'docker://' + item['mirror']))
        if config['os'] != 'linux' or config['architecture'] != 'amd64':
            raise ValueError('Reviewed base must be Linux/amd64')
        print(name + ': manifest, config and layers preserved', flush=True)
    for name, item in lock['bases'].items():
        # Publicity is not implied by successful authenticated publication.
        # Download all layers anonymously, not just a HEAD request.
        with tempfile.TemporaryDirectory(prefix='anonymous-base-') as temporary:
            subprocess.run(['skopeo', 'copy', '--src-no-creds', '--preserve-digests',
                            'docker://' + item['mirror'], 'dir:' + temporary], check=True)
        print(name + ': anonymous full download verified', flush=True)


if __name__ == '__main__':
    main()
