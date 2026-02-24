// ===============================
//  SERVER.JS — VERSION COMPATIBLE RAILWAY (BLOC 1/2)
// ===============================

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import PPTXGenJS from "pptxgenjs";
import puppeteer from "puppeteer";

// Fix FFmpeg path for Railway
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// -------------------------------
// Initialisation serveur
// -------------------------------
const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use("/uploads", express.static("uploads"));

// -------------------------------
// Initialisation OpenAI
// -------------------------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// -------------------------------
// PROMPTS IA
// -------------------------------
const SYSTEM_PROMPT = `
Tu es un expert en sécurité incendie, conformité ERP/IGH, analyse de risques,
et communication exécutive (COMEX, commissions, assurances).

Tu analyses :
- documents (PDF, DOCX, images)
- photos
- vidéos (scènes, risques, anomalies)
- consignes utilisateur

Tu produis un JSON STRICT :
{
  "presentation": "Texte structuré",
  "risk_score": 0-100,
  "conformite_ssi": 0-100,
  "evacuation": 0-100,
  "ssi": 0-100,
  "formation": 0-100,
  "conformite": 0-100,
  "maintenance": 0-100,
  "ecarts_critiques": nombre,
  "media_analysis": [
    {
      "type": "photo|video",
      "filename": "...",
      "description": "...",
      "risks": ["..."],
      "criticite": 0-100
    }
  ]
}
`;

const VIDEO_MONTAGE_PROMPT = `
Tu es un expert en analyse vidéo incendie et montage automatique.
Tu renvoies STRICTEMENT ce JSON :
{
  "criticite_video": 0-100,
  "risques_detectes": ["..."],
  "scenes": [
    { "timestamp": "00:12", "description": "Obstruction détectée", "criticite": 90 }
  ],
  "montage_script": [
    { "start": "00:00", "end": "00:05", "title": "Intro", "overlay": "Analyse vidéo incendie" }
  ]
}
`;

// -------------------------------
// UTILITAIRE — Convertir HH:MM:SS → secondes
// -------------------------------
function timeToSeconds(t) {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(t);
}

// ===============================
//  ROUTE : /api/generate-presentation
// ===============================
app.post("/api/generate-presentation", upload.fields([
  { name: "files" },
  { name: "photos" },
  { name: "videos" }
]), async (req, res) => {
  try {
    const { preset, language, instructions, site, enjeu, niveau } = req.body;

    const allFiles = [];

    const pushFiles = (list, type) => {
      if (!list) return;
      for (const file of list) {
        const buffer = fs.readFileSync(file.path);
        allFiles.push({
          name: file.originalname,
          type,
          content: buffer.toString("base64")
        });
      }
    };

    pushFiles(req.files["files"], "document");
    pushFiles(req.files["photos"], "photo");
    pushFiles(req.files["videos"], "video");

    const userPrompt = `
### CONTEXTE
Site : ${site}
Enjeu : ${enjeu}
Niveau : ${niveau}
Type : ${preset}
Langue : ${language}

### CONSIGNES
${instructions}

### MÉDIAS
${allFiles.map(f => `- ${f.type.toUpperCase()} : ${f.name}`).join("\n")}
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    });

    const json = JSON.parse(completion.choices[0].message.content);
    res.json(json);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur IA : " + err.message });
  } finally {
    if (req.files) {
      Object.values(req.files).flat().forEach(file => {
        fs.unlink(file.path, () => {});
      });
    }
  }
});// ===============================
//  SERVER.JS — VERSION COMPATIBLE RAILWAY (BLOC 2/2)
// ===============================

// ===============================
//  ROUTE : /api/generate-video-montage
// ===============================
app.post("/api/generate-video-montage", upload.array("videos"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Aucune vidéo fournie." });
    }

    const videoFiles = req.files.map(file => {
      const buffer = fs.readFileSync(file.path);
      return {
        name: file.originalname,
        content: buffer.toString("base64")
      };
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0.2,
      messages: [
        { role: "system", content: VIDEO_MONTAGE_PROMPT },
        { role: "user", content: "Analyse ces vidéos et génère un montage automatique." },
        ...videoFiles.map(v => ({
          role: "user",
          content: [
            {
              type: "input_video",
              input_video: {
                data: v.content,
                mime_type: "video/mp4"
              }
            }
          ]
        }))
      ]
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    const inputPath = req.files[0].path;
    const outputPath = path.join("uploads", `montage_${Date.now()}.mp4`);

    const script = analysis.montage_script;

    let ff = ffmpeg(inputPath);

    script.forEach(step => {
      ff = ff
        .setStartTime(step.start)
        .setDuration(
          timeToSeconds(step.end) - timeToSeconds(step.start)
        )
        .videoFilters(`drawtext=text='${step.overlay}':fontcolor=white:fontsize=24:x=20:y=20`);
    });

    ff.save(outputPath)
      .on("end", () => {
        res.json({
          video_url: "/" + outputPath,
          criticite_video: analysis.criticite_video,
          risques_detectes: analysis.risques_detectes,
          scenes: analysis.scenes
        });
      })
      .on("error", err => {
        console.error(err);
        res.status(500).json({ error: "Erreur FFmpeg : " + err.message });
      });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur IA : " + err.message });
  }
});

// ===============================
//  ROUTE : /api/export-pptx
// ===============================
app.post("/api/export-pptx", async (req, res) => {
  try {
    const { presentation, title = "Présentation incendie" } = req.body;

    const pptx = new PPTXGenJS();
    pptx.title = title;

    const blocks = presentation.split(/\n\s*\n/);

    blocks.forEach(block => {
      const slide = pptx.addSlide();
      const lines = block.split("\n").filter(l => l.trim() !== "");

      if (!lines.length) return;

      const firstLine = lines[0].replace(/^[-•]/, "").trim();
      const rest = lines.slice(1).join("\n");

      slide.addText(firstLine, {
        x: 0.5, y: 0.5, w: 9, h: 1,
        fontSize: 24, bold: true
      });

      if (rest) {
        slide.addText(rest, {
          x: 0.7, y: 1.3, w: 8.5, h: 4,
          fontSize: 16
        });
      }
    });

    const buffer = await pptx.write("nodebuffer");

    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    res.setHeader("Content-Disposition",
      `attachment; filename="presentation_incendie.pptx"`
    );

    res.send(buffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur PPTX : " + err.message });
  }
});

// ===============================
//  ROUTE : /api/export-pdf
// ===============================
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { presentation } = req.body;

    const html = `
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 12px; }
          pre { white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <h1>Rapport incendie</h1>
        <pre>${presentation}</pre>
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({ format: "A4" });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition",
      `attachment; filename="rapport_incendie.pdf"`
    );

    res.send(pdf);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur PDF : " + err.message });
  }
});

// ===============================
//  LANCEMENT SERVEUR
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur lancé sur port " + PORT);
});
