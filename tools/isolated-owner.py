#!/usr/bin/env python3
"""Start a disposable Core/Studio pair for manual development or visual checks."""

import argparse
from contextlib import ExitStack, contextmanager
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import signal
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
import time
from urllib.request import ProxyHandler, build_opener


def scratch_environment(root):
    # Do not copy owner routing, config, credentials, proxy or application variables.
    env = {name: os.environ[name] for name in ('PATH', 'SystemRoot', 'WINDIR') if name in os.environ}
    for name in ('HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
                 'XDG_RUNTIME_DIR', 'APPDATA', 'LOCALAPPDATA', 'TMPDIR', 'TEMP', 'TMP'):
        directory = root / name.lower()
        directory.mkdir(mode=0o700)
        env[name] = str(directory)
    return env


@contextmanager
def child(args, root, env):
    proc = subprocess.Popen(args, cwd=root, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, text=True)
    output = Queue()

    def read():
        for line in proc.stdout:
            output.put(line.rstrip())
        output.put(None)

    reader = Thread(target=read, daemon=True)
    reader.start()
    try:
        yield proc, output
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        reader.join(timeout=2)
        proc.stdout.close()


def ready(output, parse):
    deadline = time.monotonic() + 15
    while (remaining := deadline - time.monotonic()) > 0:
        try:
            line = output.get(timeout=remaining)
        except Empty:
            break
        if line is None:
            raise RuntimeError('child exited before readiness')
        if (result := parse(line)) is not None:
            return result
    raise RuntimeError('child readiness timed out')


def owner_ready(line):
    try:
        row = json.loads(line)
    except ValueError:
        return None
    return row if isinstance(row, dict) and row.get('event') == 'ready' else None


def pair(core, studio, check):
    with TemporaryDirectory(prefix='studio-isolated-') as scratch, ExitStack() as stack:
        root = Path(scratch).resolve(strict=True)
        env = scratch_environment(root)
        data, config, auth = (root / name for name in ('data', 'config.toml', 'studio-auth'))
        data.mkdir(mode=0o700)
        config.write_text('default_connection = "fixture"\ndefault_model = "offline"\n'
                          '[connections.fixture]\nbase_url = "http://127.0.0.1:9/v1"\n', encoding='utf-8')
        owner, output = stack.enter_context(child([core, 'serve', '--data-dir', data, '--config', config], root, env))
        row = ready(output, owner_ready)
        if row.get('data_dir') != str(data) or not row.get('instance_id') or owner.poll() is not None:
            raise RuntimeError('Core did not start in the owned scratch data directory')
        endpoint = data / 'endpoint.json'
        if endpoint.is_symlink() or json.loads(endpoint.read_text(encoding='utf-8')).get('instance_id') != row['instance_id']:
            raise RuntimeError('scratch endpoint does not belong to the started Core')
        bridge, output = stack.enter_context(child([studio, '--listen', '127.0.0.1:0', '--data-dir', data,
                                                    '--config-dir', auth], root, env))
        opened = ready(output, lambda line: re.fullmatch(r'open (http://127\.0\.0\.1:\d+/#token=[A-Za-z0-9_-]+)', line))
        if owner.poll() is not None or bridge.poll() is not None:
            raise RuntimeError('scratch pair exited during startup')
        if check:
            opener = build_opener(ProxyHandler({}))
            with opener.open(opened[1].split('/#')[0] + '/healthz', timeout=10) as response:
                if response.read() != b'ok':
                    raise RuntimeError('scratch Studio returned unexpected health response')
            print('Isolated Core and Studio started; scratch health check passed.')
            return
        print(opened[1], flush=True)
        while owner.poll() is None and bridge.poll() is None:
            time.sleep(0.25)
        raise RuntimeError('scratch pair exited; no fallback owner will be used')


def interrupt(_signal, _frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core', type=Path, required=True, help='exact pinned Core executable')
    parser.add_argument('--studio', type=Path, required=True, help='Studio executable with embedded frontend')
    parser.add_argument("--check", action="store_true", help="check isolated startup and exit without printing the token")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupt)
    try:
        pair(args.core.resolve(strict=True), args.studio.resolve(strict=True), args.check)
    except KeyboardInterrupt:
        return
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f'isolated owner: {error}\n')


if __name__ == '__main__':
    main()
