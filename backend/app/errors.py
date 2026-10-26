"""返回给页面的错误。消息里不能带密钥。"""

import re

_SECRET = re.compile(r"(sk-[A-Za-z0-9_\-]{6,}|Bearer\s+\S+|api[_-]?key['\"=: ]+\S+)", re.IGNORECASE)


class AppError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def redact(text: str) -> str:
    cleaned = _SECRET.sub("***", text).replace("\n", " ").strip()
    return cleaned[:500] or "请求失败"
