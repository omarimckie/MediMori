ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN apk add --no-cache git
WORKDIR /opt
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/engineering-sandbox-runner.mjs /opt/engineering-sandbox-runner.mjs
USER 1000:1000
ENTRYPOINT ["node", "/opt/engineering-sandbox-runner.mjs"]
