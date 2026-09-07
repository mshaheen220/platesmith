# syntax=docker/dockerfile:1
#
# Single-container production image: the Vite frontend is built to static
# assets and served by the same FastAPI process that serves the API, on one
# port - matching how the other local 3D-printing tools (e.g.
# chocolate-mold-factory) are containerized.

##
## ---- Stage: build the Vite frontend into static assets ----
##
FROM node:22-bookworm-slim AS client-builder
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client .
RUN npm run build

##
## ---- Stage: runtime image ----
##
FROM python:3.13-slim AS runtime

# opencv-python-headless still needs a couple of shared libs on Debian slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/app ./app
# Served by the StaticFiles mount at the end of app/main.py - only present in
# this built image, so local (non-Docker) dev keeps using the Vite dev server.
COPY --from=client-builder /app/client/dist ./app/static

RUN useradd --system --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request as u, sys; sys.exit(0 if u.urlopen('http://localhost:8001/api/health').status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
