"""Store a dedicated xAI key using hidden terminal input, never argv or dotenv."""
import getpass
from pathlib import Path
import warnings
from setup_key import store_key


def main():
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('xAI API key (hidden): ')
        store_key(key.strip(), Path.home()/'.config/fusion/xai.key')
    except (ValueError, OSError, EOFError, getpass.GetPassWarning):
        print('Key setup failed. Use an interactive terminal and a valid writable credential path.')
        return 1
    except KeyboardInterrupt:
        print('\nCancelled.')
        return 1
    print('Saved ~/.config/fusion/xai.key with file mode 0600 and directory mode 0700.')
    print('Refresh models to verify the key; storing it alone does not verify xAI access.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
