FROM node:24.3.0-bookworm-slim@sha256:8225b1806c6e37dced949224b5c0d8278a2fe593967288620e0af69b2cbc4539
RUN npm install --global --ignore-scripts typescript@7.0.2 && npm cache clean --force
USER 65534:65534
WORKDIR /project
