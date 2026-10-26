"""运行路径。测试通过环境变量把数据指到临时目录，避免碰到真实密钥。"""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    configured = os.environ.get("KNOWLEDGE_HUB_DATA")
    directory = Path(configured) if configured else PROJECT_ROOT / "data"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def database_path() -> Path:
    return data_dir() / "hub.sqlite3"


def files_dir() -> Path:
    directory = data_dir() / "files"
    directory.mkdir(parents=True, exist_ok=True)
    return directory
