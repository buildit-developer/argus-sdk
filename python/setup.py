from setuptools import setup, find_packages

with open("README.md", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="buildit-argus",
    version="0.1.1",
    description="Argus observability SDK for Python — tracks per-call cost and latency for Anthropic and OpenAI",
    long_description=long_description,
    long_description_content_type="text/markdown",
    packages=find_packages(),
    python_requires=">=3.9",
    license="MIT",
    keywords=["llm", "observability", "anthropic", "openai", "argus"],
    url="https://github.com/buildit-developer/argus-sdk",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)
