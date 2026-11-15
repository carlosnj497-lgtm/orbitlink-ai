"""Ponto de entrada do agente empacotado (PyInstaller). Mesmo comando do `python -m astryon_agent`."""

import sys

from astryon_agent.cli import main

if __name__ == "__main__":
    sys.exit(main())
