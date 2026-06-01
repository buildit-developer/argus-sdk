"""Activated by buildit_argus.pth at Python startup."""
import os

if os.environ.get('ARGUS_KEY'):
    try:
        from argus.auto import patch_all
        patch_all()
    except Exception:
        pass
