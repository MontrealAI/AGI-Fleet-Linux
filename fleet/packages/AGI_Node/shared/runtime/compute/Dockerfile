FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pil python3-tk python3-numpy python3-pandas python3-scipy python3-matplotlib python3-reportlab python3-docx python3-openpyxl python3-venv python3-xlsxwriter python3-pytest git jq poppler-utils ca-certificates libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw fonts-dejavu fonts-liberation xvfb x11-utils xdotool xclip fluxbox mousepad chromium imagemagick ffmpeg build-essential && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/agi-requirements.txt
RUN python3 -m venv --system-site-packages /opt/agi-venv && /opt/agi-venv/bin/pip install --no-cache-dir --require-hashes --no-deps -r /tmp/agi-requirements.txt && /opt/agi-venv/bin/python -c "import docx,openpyxl,pptx,PIL,reportlab" && rm /tmp/agi-requirements.txt
ENV PATH="/opt/agi-venv/bin:${PATH}"
COPY workstation/agi-desktop.py /usr/local/bin/agi-desktop
COPY workstation/agi-inspect.py /usr/local/bin/agi-inspect
COPY workstation/selftest.py /usr/local/lib/agi-workstation-selftest.py
COPY workstation/fixture.py /usr/local/lib/fixture.py
RUN chmod 755 /usr/local/bin/agi-desktop /usr/local/bin/agi-inspect
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
