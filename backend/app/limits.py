"""本机演示的文件上限。

数字取自 RAGFlow 的批量限制和百炼的单文件建议，再按一台电脑能承受的范围收紧。
"""

MAX_BATCH = 32
MAX_DOCUMENTS = 200
MAX_PDF_PAGES = 200
MAX_TABLE_ROWS = 10_000

_MB = 1024 * 1024
SIZE_LIMITS = {
    "pdf": 50 * _MB,
    "docx": 50 * _MB,
    "md": 10 * _MB,
    "csv": 10 * _MB,
    "xlsx": 10 * _MB,
    "png": 10 * _MB,
    "jpg": 10 * _MB,
    "jpeg": 10 * _MB,
    "webp": 10 * _MB,
    "tif": 10 * _MB,
    "tiff": 10 * _MB,
}


class LimitError(Exception):
    pass


def extension_of(name: str) -> str:
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1].lower()


def check_upload(name: str, size: int) -> str:
    extension = extension_of(name)
    if extension == "doc":
        raise LimitError("第一版请把 .doc 另存为 .docx 后再上传")
    if extension == "xls":
        raise LimitError("第一版请把 .xls 另存为 .xlsx 或 .csv 后再上传")
    if extension not in SIZE_LIMITS:
        raise LimitError(f"不支持 .{extension or '未知'} 文件")
    if size <= 0:
        raise LimitError(f"“{name}”是空文件")
    if size > SIZE_LIMITS[extension]:
        limit_mb = SIZE_LIMITS[extension] // _MB
        raise LimitError(f"“{name}”超过 {limit_mb} MB 的大小限制")
    return extension
