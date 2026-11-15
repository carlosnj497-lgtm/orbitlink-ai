"""`python -m astryon_agent`: a linha de comando fica em cli.py (o PyInstaller não empacota módulos __main__)."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
