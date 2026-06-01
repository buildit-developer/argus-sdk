from setuptools import setup, find_packages

setup(
    name="argus-python",
    version="0.1.0",
    description="Argus observability SDK for Python — tracks per-call cost and latency for Anthropic and OpenAI",
    packages=find_packages(),
    python_requires=">=3.9",
    license="MIT",
)
