# ===============================
#  DOCKERFILE — BACKEND INCENDIE
#  Compatible Railway / Node 18+
# ===============================

# Image Node officielle
FROM node:18-slim

# Installer dépendances système nécessaires à Puppeteer + FFmpeg
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Définir le dossier de travail
WORKDIR /app

# Copier package.json + package-lock si présent
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le reste du code
COPY . .

# Exposer le port Railway
EXPOSE 3000

# Lancer le serveur
CMD ["npm", "start"]
