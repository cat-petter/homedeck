"""Module entry point: ``python -m homedeck`` starts the FastAPI server.

Run from the ``backend/`` directory so the ``homedeck`` package is importable.
"""

from .main import run

if __name__ == "__main__":
    run()
