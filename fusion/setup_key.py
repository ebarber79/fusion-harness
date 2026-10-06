"""Store an OpenAI key locally without echoing it or accepting it in argv."""
import getpass
import os
from pathlib import Path
import tempfile


def store_key(key, path=None):
    if not isinstance(key, str) or not key or len(key) > 4096 or any(c.isspace() for c in key):
        raise ValueError('Key must be a nonempty single token (at most 4096 characters).')
    path = Path(path) if path is not None else Path.home()/'.config/fusion/openai.key'
    parent = path.parent
    if parent.is_symlink() or path.is_symlink():
        raise ValueError('Refusing a symlink credential path.')
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(prefix='.openai-', dir=parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(key + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    # getpass can fall back to visible stdin when no TTY exists: fail closed instead.
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('OpenAI API key (hidden): ')
        store_key(key.strip())
    except (ValueError, OSError, EOFError, getpass.GetPassWarning):
        print('Key setup failed. Use an interactive terminal and a valid writable credential path.')
        return 1
    except KeyboardInterrupt:
        print('\nCancelled.')
        return 1
    print('Saved ~/.config/fusion/openai.key with file mode 0600 and directory mode 0700.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
