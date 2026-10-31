# SpendWise server: stateless, no database, no volume needed. Build from the backend/ folder:
#   docker build -t spendwise-api backend
#   docker run -p 8000:8000 -e SPENDWISE_ORIGINS=https://your-site.pages.dev spendwise-api
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY core ./core
RUN useradd --system --no-create-home app
USER app
EXPOSE 8000
# --no-access-log: request lines are not written anywhere, so nothing about who uploaded what is kept.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --proxy-headers"]
