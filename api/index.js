const express = require('express');
const multer = require('multer');
const fs = require('fs');
import OpenAI from "openai";

const app = express();
const upload = multer({ dest: '/tmp' });

// Enable CORS
const allowCors = (fn) => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

const handler = (req, res) => {
  app(req, res);
};

// Initialize OpenAI API with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
// Function to transcribe audio
async function transcribeAudio(filePath) {
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
    response_format: "text",
  });
  return response.text;
}

// Function to get GPT-generated response based on transcription
async function getGPTResponse(transcription) {
  const response = await openai.openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: transcription }],
  });
  return response.choices[0].message;
}

// Function to convert GPT response to speech with streaming
async function streamTextToSpeech(gptResponse, res) {
  const ttsResponse = await openai.audio.speech.create({
  model: "tts-1",
  voice: "alloy",
  input: gptResponse,
});

  // Stream each audio chunk to the client
  ttsResponse.data.on('data', (chunk) => {
    res.write(chunk);
  });

  // End the response once TTS generation completes
  ttsResponse.data.on('end', () => {
    res.end();
  });
}

// Main endpoint to handle audio upload, transcription, GPT response, and TTS streaming
app.post('/prompt-nova', upload.single('audio'), async (req, res) => {
  try {
    const audioFilePath = req.file.path;

    // Step 1: Transcribe audio
    const transcription = await transcribeAudio(audioFilePath);

    // Step 2: Generate response using GPT based on the transcription
    const gptResponse = await getGPTResponse(transcription);

    // Step 3: Set response headers for streaming audio
    res.setHeader('Content-Type', 'audio/mpeg');

    // Step 4: Convert GPT response to TTS audio and stream it to the client
    await streamTextToSpeech(gptResponse, res);

    // Cleanup: Delete the audio file after processing
    fs.unlink(audioFilePath, (err) => {
      if (err) console.error('Failed to delete file:', err);
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error processing the audio file.');
  }
});

// Start server (for local testing only; Vercel will handle deployment)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = allowCors(handler);