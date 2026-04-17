# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g vite
COPY --from=build /app/dist ./dist
EXPOSE 4173
CMD ["vite", "preview", "--host", "0.0.0.0", "--port", "4173", "--allowed-hosts", "grid.triunemyanmar.com"]
