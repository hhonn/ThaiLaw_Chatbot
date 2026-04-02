from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# ── Ensure app/ is on path so rag_chain imports work ──────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

from rag_chain import (
    MAX_QUESTION_LENGTH,
    answer_question,
    stream_answer,
)
from auth import send_otp, verify_otp
from analytics import (
    bootstrap_training_data,
    classify_legal_topic,
    export_instruction_rows,
    export_training_pairs,
    export_training_rows,
    generate_sample_conversations,
    get_summary,
    get_user_insights,
    init_analytics_db,
    log_event,
    redact_text_for_training,
    write_training_snapshots,
)

logger = logging.getLogger(__name__)

init_analytics_db()
ANALYTICS_ADMIN_KEY = os.environ.get("ANALYTICS_ADMIN_KEY", "").strip()

# FastAPI app

app = FastAPI(
    title="Thai Law Chatbot API",
    version="1.0.0",
    description="RAG-powered Thai law Q&A API with hybrid search, reranking, and streaming.",
)

# CORS — allow Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:7860",
        "http://127.0.0.1:7860",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request / Response schemas

class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_QUESTION_LENGTH)
    history: List[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    citations: str
    domain: str
    risk: str

# Auth schemas

class SendCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=254)


class VerifyCodeRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=254)
    code: str = Field(..., min_length=4, max_length=6)


# Analytics schemas

class AnalyticsEventRequest(BaseModel):
    event_type: str = Field(..., min_length=2, max_length=64)
    user_email: Optional[str] = Field(default=None, min_length=5, max_length=254)
    session_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    message_length: Optional[int] = Field(default=None, ge=0, le=20000)
    message_text: Optional[str] = Field(default=None, min_length=1, max_length=MAX_QUESTION_LENGTH)
    topic: Optional[str] = Field(default=None, min_length=1, max_length=64)
    metadata: Optional[Dict[str, Any]] = None


class AnalyticsExportRequest(BaseModel):
    days: int = Field(default=30, ge=1, le=365)
    limit: int = Field(default=2000, ge=1, le=20000)
    format: str = Field(default="json", pattern="^(json|jsonl)$")
    dataset: str = Field(default="questions", pattern="^(questions|pairs|instruction)$")
    style: str = Field(default="native", pattern="^(native|chatml|alpaca)$")
    topic: Optional[str] = Field(default=None, min_length=1, max_length=64)
    domain: Optional[str] = Field(default=None, min_length=1, max_length=64)
    risk: Optional[str] = Field(default=None, min_length=1, max_length=64)


class AnalyticsSnapshotRequest(BaseModel):
    days: int = Field(default=30, ge=1, le=365)
    limit: int = Field(default=3000, ge=1, le=20000)
    topic: Optional[str] = Field(default=None, min_length=1, max_length=64)
    domain: Optional[str] = Field(default=None, min_length=1, max_length=64)
    risk: Optional[str] = Field(default=None, min_length=1, max_length=64)
    group: str = Field(default="real", pattern="^(real|samples)?$")


class AnalyticsGenerateSampleRequest(BaseModel):
    count: int = Field(default=20, ge=1, le=200)


class AnalyticsBootstrapRequest(BaseModel):
    sample_count: int = Field(default=30, ge=1, le=200)
    days: int = Field(default=30, ge=1, le=365)
    limit: int = Field(default=3000, ge=1, le=20000)
    topic: Optional[str] = Field(default=None, min_length=1, max_length=64)
    domain: Optional[str] = Field(default=None, min_length=1, max_length=64)
    risk: Optional[str] = Field(default=None, min_length=1, max_length=64)


# Auth endpoints

@app.post("/api/auth/send-code")
async def auth_send_code(req: SendCodeRequest):
    """Send a 6-digit OTP to the given email address."""
    try:
        send_otp(req.email)
        return {"ok": True, "message": "รหัสยืนยันถูกส่งไปยังอีเมลแล้ว"}
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to send OTP: %s", exc)
        raise HTTPException(status_code=500, detail="ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่")


@app.post("/api/auth/verify-code")
async def auth_verify_code(req: VerifyCodeRequest):
    """Verify the OTP code for a given email."""
    if verify_otp(req.email, req.code):
        return {"ok": True, "email": req.email, "name": req.email.split("@")[0]}
    raise HTTPException(status_code=401, detail="รหัสยืนยันไม่ถูกต้องหรือหมดอายุ")


# Analytics endpoints

@app.post("/api/analytics/event")
async def analytics_event(req: AnalyticsEventRequest):
    topic = req.topic
    if not topic and req.message_text:
        topic = classify_legal_topic(req.message_text)

    metadata: Dict[str, Any] = dict(req.metadata or {})
    if req.message_text:
        metadata["message_text_redacted"] = redact_text_for_training(req.message_text)

    log_event(
        event_type=req.event_type,
        user_email=req.user_email,
        session_id=req.session_id,
        topic=topic,
        message_length=req.message_length,
        metadata=metadata,
    )
    return {"ok": True}


@app.get("/api/analytics/summary")
async def analytics_summary(request: Request, days: int = 30):
    _require_analytics_admin(request)
    return get_summary(days=days)


@app.get("/api/analytics/users")
async def analytics_users(request: Request, days: int = 30, limit: int = 25):
    _require_analytics_admin(request)
    return {"users": get_user_insights(days=days, limit=limit)}


@app.post("/api/analytics/export")
async def analytics_export(req: AnalyticsExportRequest, request: Request):
    _require_analytics_admin(request)
    if req.dataset == "pairs":
        rows = export_training_pairs(
            days=req.days,
            limit=req.limit,
            topic=req.topic,
            domain=req.domain,
            risk=req.risk,
        )
    elif req.dataset == "instruction":
        rows = export_instruction_rows(
            days=req.days,
            limit=req.limit,
            style=req.style,
            topic=req.topic,
            domain=req.domain,
            risk=req.risk,
        )
    else:
        rows = export_training_rows(days=req.days, limit=req.limit, topic=req.topic)

    if req.format == "jsonl":
        payload = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
        return {
            "format": "jsonl",
            "dataset": req.dataset,
            "style": req.style,
            "count": len(rows),
            "content": payload,
        }

    return {
        "format": "json",
        "dataset": req.dataset,
        "style": req.style,
        "count": len(rows),
        "rows": rows,
    }


@app.post("/api/analytics/export/snapshot")
async def analytics_export_snapshot(req: AnalyticsSnapshotRequest, request: Request):
    _require_analytics_admin(request)
    return write_training_snapshots(
        days=req.days,
        limit=req.limit,
        topic=req.topic,
        domain=req.domain,
        risk=req.risk,
        group=req.group,
    )


@app.post("/api/analytics/generate-samples")
async def analytics_generate_samples(req: AnalyticsGenerateSampleRequest, request: Request):
    _require_analytics_admin(request)
    return generate_sample_conversations(count=req.count)


@app.post("/api/analytics/bootstrap-training-data")
async def analytics_bootstrap_training_data(req: AnalyticsBootstrapRequest, request: Request):
    _require_analytics_admin(request)
    return bootstrap_training_data(
        sample_count=req.sample_count,
        days=req.days,
        limit=req.limit,
        topic=req.topic,
        domain=req.domain,
        risk=req.risk,
    )


# Endpoints

@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "model": "typhoon-v2.5-30b-a3b-instruct"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Non-streaming chat endpoint."""
    pairs = _history_to_pairs(req.history)
    answer, citations, domain, risk = answer_question(req.message, pairs)
    return ChatResponse(answer=answer, citations=citations, domain=domain, risk=risk)


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    Streaming chat endpoint using Server-Sent Events (SSE).
    Each event is a JSON object with partial answer + metadata.
    """
    pairs = _history_to_pairs(req.history)

    def event_generator():
        try:
            for partial, citations, domain, risk in stream_answer(req.message, pairs):
                data = json.dumps(
                    {
                        "answer": partial,
                        "citations": citations,
                        "domain": domain,
                        "risk": risk,
                    },
                    ensure_ascii=False,
                )
                yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.exception("Stream error: %s", exc)
            err = json.dumps(
                {"error": str(exc)},
                ensure_ascii=False,
            )
            yield f"data: {err}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

# Helpers

def _history_to_pairs(history: List[ChatMessage]) -> List[Tuple[str, str]]:
    """Convert flat message list to (user, assistant) pairs."""
    pairs: list[tuple[str, str]] = []
    i = 0
    while i < len(history) - 1:
        if history[i].role == "user" and history[i + 1].role == "assistant":
            pairs.append((history[i].content, history[i + 1].content))
            i += 2
        else:
            i += 1
    return pairs


def _require_analytics_admin(request: Optional[Request]) -> None:
    if not ANALYTICS_ADMIN_KEY:
        return
    if request is None:
        raise HTTPException(status_code=401, detail="Unauthorized")

    provided = request.headers.get("x-analytics-key", "").strip()
    if provided != ANALYTICS_ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

# Run with uvicorn

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("APP_HOST", "127.0.0.1")
    port = int(os.environ.get("APP_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")