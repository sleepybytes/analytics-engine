from fastapi import APIRouter

from ..models.events import CapturePayload
from ..services import ingestion

router = APIRouter()


@router.post("/capture")
async def capture(payload: CapturePayload):
    return await ingestion.ingest(payload)
