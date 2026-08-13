FROM node:20-alpine

WORKDIR /app/server

COPY server/package*.json ./
RUN npm install

COPY server/ ./

EXPOSE 3000

CMD ["npm", "start"]