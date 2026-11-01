"""Receipt scanning: a bill photo in, structured expense fields out (Gemini vision via the Emergent LLM key)."""
import json
import logging
import os
import re
import uuid
from datetime import date

from fastapi import APIRouter, HTTPException

from models.receipts import ReceiptScan, ReceiptScanRequest

router = APIRouter()
logger = logging.getLogger(__name__)

PROMPT = """You read photos of receipts and bills for a group-travel expense app.
Return ONLY a JSON object, no prose, with keys:
- "is_receipt": boolean, false if the image is not a receipt/bill/invoice/ticket
- "merchant": short merchant or description, e.g. "Café 1947" (string, "" if unknown)
- "amount": the final total paid as a number without currency symbols or thousands separators (null if unreadable)
- "currency": ISO 4217 code, e.g. "INR" if you see ₹/Rs (default "INR")
- "date": the bill date as YYYY-MM-DD (null if not visible)
- "category": one of "stay","food","transport","activities","shopping","other"
- "confidence": "high","medium" or "low" for how sure you are about the amount."""

VALID_CATS = {"stay", "food", "transport", "activities", "shopping", "other"}


def _parse(raw: str) -> ReceiptScan:
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        raise ValueError("no JSON in model output")
    data = json.loads(match.group(0))
    amount = data.get("amount")
    try:
        amount = round(float(str(amount).replace(",", "")), 2) if amount not in (None, "") else None
    except ValueError:
        amount = None
    if amount is not None and amount <= 0:
        amount = None
    d = data.get("date")
    try:
        d = date.fromisoformat(str(d)).isoformat() if d else None
    except ValueError:
        d = None
    cat = data.get("category") if data.get("category") in VALID_CATS else "other"
    conf = data.get("confidence") if data.get("confidence") in {"high", "medium", "low"} else "low"
    currency = str(data.get("currency") or "INR").upper()[:3]
    return ReceiptScan(
        merchant=str(data.get("merchant") or "")[:80],
        amount=amount,
        currency=currency,
        date=d,
        category=cat,
        confidence=conf,
        is_receipt=bool(data.get("is_receipt", True)),
    )


@router.post("/receipts/scan", response_model=ReceiptScan)
async def scan_receipt(body: ReceiptScanRequest):
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Receipt scanning is not configured")
    try:  # not on public PyPI: a missing package disables this route, not the whole backend
        from emergentintegrations.llm.chat import ImageContent, LlmChat, StreamDone, TextDelta, UserMessage
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Receipt scanning is not configured") from exc
    b64 =body.image_base64.split(",", 1)[-1]
    chat = LlmChat(api_key=key, session_id=f"receipt-{uuid.uuid4()}", system_message=PROMPT).with_model(
        "gemini", "gemini-3-flash-preview"
    )
    raw = ""
    try:
        async for ev in chat.stream_message(
            UserMessage(text="Extract the expense from this receipt.", file_contents=[ImageContent(image_base64=b64)])
        ):
            if isinstance(ev, TextDelta):
                raw += ev.content
            elif isinstance(ev, StreamDone):
                break
    except Exception as exc:  # provider/network failure
        logger.exception("receipt scan failed")
        raise HTTPException(status_code=502, detail="Couldn't read the receipt right now. Please try again.") from exc
    try:
        return _parse(raw)
    except (ValueError, json.JSONDecodeError):
        logger.warning("unparseable receipt output: %s", raw[:300])
        raise HTTPException(status_code=422, detail="Couldn't find a total on this receipt. Try a clearer photo.")
