from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_path: str = "/data/analytics.duckdb"
    project_api_key: str = "dev_project_key"
    project_id: str = "proj_dev_001"
    log_level: str = "info"
    alert_webhook_url: Optional[str] = None   # POST here on every NL miss

    model_config = {"env_file": ".env"}


settings = Settings()
