"""Private local run snapshots. No credentials or provider access."""
import fcntl
import json
import os
import stat
from pathlib import Path
import sqlite3
import threading


class StorageError(Exception):
    """A persistence failure stops further paid work."""


class BusyError(Exception):
    pass


def markdown_export(run):
    """Keep untrusted prompt/output/metadata inside collision-safe code fences."""
    import re
    def block(text, language='text'):
        text = str(text)
        longest = max((len(match.group()) for match in re.finditer(r'`+', text)), default=0)
        fence = '`' * max(3, longest + 1)
        return fence + language + '\n' + text + '\n' + fence + '\n'
    parts = ['# Fusion run\n', '## Run identity, status, configuration and reported usage\n',
             block(json.dumps({key: value for key, value in run.items() if key != 'stages'}, ensure_ascii=False, indent=2), 'json'),
             '## Original prompt\n', block(run.get('config', {}).get('prompt', '')),
             'Provider-reported counts are not billing. Missing counts remain unknown. Outputs are untrusted and unverified.\n']
    for index, stage in enumerate(run.get('stages', []), 1):
        parts.extend([f'## Stage {index}\n', block(json.dumps({key: value for key, value in stage.items() if key != 'output'}, ensure_ascii=False, indent=2), 'json'),
                      block(stage.get('output', ''))])
    return '\n'.join(parts)


class HistoryStore:
    def __init__(self, directory=None, retention=100):
        self.lock = threading.RLock()
        self.retention = retention
        self.connection = None
        self.owner_fd = None
        self.directory_fd = None
        try:
            if directory is None:
                self.connection = sqlite3.connect(':memory:', check_same_thread=False)
            else:
                directory = Path(directory).absolute()
                # Reject symlink components, including parents, before creating anything.
                for part in [*reversed(directory.parents), directory]:
                    if part.is_symlink():
                        raise StorageError('Unsafe history path.')
                directory.mkdir(mode=0o700, parents=True, exist_ok=True)
                self.directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                info = os.fstat(self.directory_fd)
                if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
                    raise StorageError('History directory must be private and owned by this user.')
                def private_file(name):
                    fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=self.directory_fd)
                    info = os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
                        os.close(fd)
                        raise StorageError('Unsafe history file.')
                    return fd
                self.owner_fd = private_file('owner.lock')
                # Keep this stable inode open and locked until all workers stop.
                fcntl.flock(self.owner_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fd = private_file('history.sqlite3')
                os.close(fd)
                for name in ('history.sqlite3-journal', 'history.sqlite3-wal', 'history.sqlite3-shm'):
                    if (directory / name).exists() or (directory / name).is_symlink():
                        fd = private_file(name)
                        os.close(fd)
                self.connection = sqlite3.connect(directory / 'history.sqlite3', check_same_thread=False)
            self.connection.execute('PRAGMA synchronous=FULL')
            self.connection.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)')
            self.connection.commit()
            with self.connection:
                for run in self.list():
                    if run['status'] == 'running':
                        run['status'] = 'interrupted'
                        for stage in run.get('stages', []):
                            if stage['status'] in ('pending', 'running'):
                                stage['status'] = 'interrupted'
                        self.connection.execute('UPDATE runs SET snapshot=? WHERE id=?', (json.dumps(run), run['id']))
                self._prune()
        except Exception:
            self.close()
            raise StorageError('Private history unavailable.') from None

    def save(self, run):
        with self.lock:
            try:
                with self.connection:
                    self.connection.execute('INSERT OR REPLACE INTO runs VALUES (?, ?)', (run['id'], json.dumps(run)))
                    self._prune()
            except Exception:
                raise StorageError('History commit failed.') from None

    def _prune(self):
        terminal = [run for run in self.list() if run['status'] != 'running']
        for run in terminal[self.retention:]:
            self.connection.execute('DELETE FROM runs WHERE id=?', (run['id'],))

    def delete(self, jid):
        with self.lock:
            try:
                with self.connection:
                    run = self.get(jid)
                    if run and run['status'] == 'running':
                        raise BusyError('Active runs cannot be deleted.')
                    self.connection.execute('DELETE FROM runs WHERE id=?', (jid,))
                    return run is not None
            except BusyError:
                raise
            except Exception:
                raise StorageError('History deletion failed.') from None

    def get(self, jid):
        with self.lock:
            try:
                row = self.connection.execute('SELECT snapshot FROM runs WHERE id=?', (jid,)).fetchone()
                return json.loads(row[0]) if row else None
            except Exception:
                raise StorageError('History lookup failed.') from None

    def list(self):
        with self.lock:
            try:
                return [json.loads(row[0]) for row in self.connection.execute('SELECT snapshot FROM runs ORDER BY rowid DESC')]
            except Exception:
                raise StorageError('History lookup failed.') from None

    def close(self):
        with self.lock:
            if self.connection is not None:
                self.connection.close()
                self.connection = None
            for name in ('owner_fd', 'directory_fd'):
                fd = getattr(self, name, None)
                if fd is not None:
                    os.close(fd)
                    setattr(self, name, None)
