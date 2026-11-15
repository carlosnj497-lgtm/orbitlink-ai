"""Ponto de entrada do agente empacotado (PyInstaller). Mesmo comando do `python -m orbitlink_agent`."""

import sys

from orbitlink_agent.cli import main

if __name__ == "__main__":
    sys.exit(main())
