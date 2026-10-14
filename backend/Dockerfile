# syntax=docker/dockerfile:1
FROM python:3.14-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN groupadd --system --gid 1000 devhub \
    && useradd --system --uid 1000 --gid devhub --home /app --shell /usr/sbin/nologin devhub

COPY requirements/ requirements/
RUN pip install -r requirements/base.txt

# ---------------------------------------------------------------- development
FROM base AS dev
RUN pip install -r requirements/dev.txt
COPY . .
RUN chmod +x docker/entrypoint.sh
USER devhub
EXPOSE 8000
ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ---------------------------------------------------------------- production
FROM base AS prod
ENV DJANGO_SETTINGS_MODULE=config.settings.production
COPY --chown=devhub:devhub . .
RUN chmod +x docker/entrypoint.sh \
    && DJANGO_SECRET_KEY=build-only-placeholder-not-used-at-runtime-000000000000000000 \
       python manage.py collectstatic --noinput --settings=config.settings.base \
    && chown -R devhub:devhub /app/staticfiles
USER devhub
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/', timeout=4).status==200 else 1)"
ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "30", "--access-logfile", "-"]
