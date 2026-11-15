FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=ui /ui/dist /usr/share/nginx/html
COPY deploy/nginx/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/rate-limits.conf /etc/nginx/conf.d/00-rate-limits.conf
COPY deploy/nginx/device-allow.conf /etc/nginx/device-allow.conf
