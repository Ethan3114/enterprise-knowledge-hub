"""本机服务入口。"""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .errors import AppError
from .routes import router
from .store import startup


class UTF8JSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(content, ensure_ascii=False).encode("utf-8")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    startup()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="企业知识库中台", default_response_class=UTF8JSONResponse, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_request, error: AppError):
        return UTF8JSONResponse({"detail": error.message}, status_code=error.status_code)

    app.include_router(router)
    return app


app = create_app()
