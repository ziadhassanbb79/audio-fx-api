FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY .env.example ./

ENV PORT=3000
ENV FFMPEG_PATH=ffmpeg

EXPOSE 3000

CMD ["npm", "start"]
