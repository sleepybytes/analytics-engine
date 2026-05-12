from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_path: str = "/data/analytics.duckdb"
    project_api_key: str = "dev_project_key"
    project_id: str = "proj_dev_001"
    log_level: str = "info"

    model_config = {"env_file": ".env"}


settings = Settings()
