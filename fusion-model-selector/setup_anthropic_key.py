"""Dedicated Anthropic key setup; hidden terminal input only."""
import getpass
from pathlib import Path
import warnings
from setup_key import store_key


def main():
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('Anthropic API key (hidden): ')
        key = key.strip()
        if not key or len(key) > 4096 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in key):
            raise ValueError('Invalid Anthropic key.')
        store_key(key, Path.home()/'.config/fusion/anthropic.key')
    except (ValueError, OSError, EOFError, getpass.GetPassWarning):
        print('Key setup failed. Use an interactive terminal and a valid writable credential path.')
        return 1
    except KeyboardInterrupt:
        print('\nCancelled.')
        return 1
    print('Saved ~/.config/fusion/anthropic.key with file mode 0600 and directory mode 0700.')
    print('Refresh models to verify catalog access; saving alone does not verify credits or generation.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
