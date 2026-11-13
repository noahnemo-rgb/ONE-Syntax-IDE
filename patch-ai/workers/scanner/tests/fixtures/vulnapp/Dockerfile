FROM python:3.6
USER root
ADD . /app
RUN pip install -r /app/requirements.txt
CMD ["python", "/app/app.py"]
