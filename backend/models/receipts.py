from typing import Literal, Optional

from pydantic import BaseModel, Field

ExpenseCategory = Literal["stay", "food", "transport", "activities", "shopping", "other"]


class ReceiptScanRequest(BaseModel):
    image_base64: str = Field(min_length=100, max_length=8_000_000)
    mime_type: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class ReceiptScan(BaseModel):
    merchant: str = ""
    amount: Optional[float] = None
    currency: str = "INR"
    date: Optional[str] = None  # yyyy-mm-dd
    category: ExpenseCategory = "other"
    confidence: Literal["high", "medium", "low"] = "low"
    is_receipt: bool = True
