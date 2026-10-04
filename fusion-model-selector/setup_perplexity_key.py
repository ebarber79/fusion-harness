"""Dedicated Perplexity credential setup; input is hidden and never accepted in argv."""
import getpass
from pathlib import Path
import warnings
from setup_key import store_key


def main():
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('Perplexity API key (hidden): ')
        store_key(key.strip(), Path.home()/'.config/fusion/perplexity.key')
    except (ValueError, OSError, EOFError, getpass.GetPassWarning):
        print('Key setup failed. Use an interactive terminal and a writable credential path.')
        return 1
    except KeyboardInterrupt:
        print('\nCancelled.')
        return 1
    print('Saved ~/.config/fusion/perplexity.key with file mode 0600 and directory mode 0700.')
    print('Refresh models to verify catalog access; generation access and credits remain untested.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
