const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require("openai");
const { Readable } = require('stream');

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
    temperature : '0.2', 
  });
  return response.text;
}

// Function to get GPT-generated response based on transcription
async function getGPTResponse(transcription) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: transcription }],
    frequency_penalty: 2.0,
    presence_penalty: 2.0, 
    temperature: 0.2, 
  });
  return response.choices[0];
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
          if (!req.file) {
            console.error('No file received in the request');
            return res.status(400).json({ error: 'Audio file is required' });
          }
          
          const originalFilePath = path.join('/tmp', req.file.filename);

          const newFilename = `nova.m4a`; // Customize your new filename as needed
          const newFilePath = path.join('/tmp', newFilename);

          // Rename the file
          fs.rename(originalFilePath, newFilePath, async(err) => {
              if (err) {
                console.error('Error renaming file:', err);
                return res.status(500).json({ error: 'Failed to rename file' });
              }
              
              //console.log('Uploaded file info:', newFilePath);

              // Step 1: Transcribe audio
              const transcription = await transcribeAudio(newFilePath);
              
              console.log(transcription);

              // Step 2: Generate response using GPT based on the transcription
              const gptResponse = await getGPTResponse(transcription);
              
              console.log(gptResponse);
              
              res.status(500).end();

              // Step 3: Set response headers for streaming audio
              res.setHeader('Content-Type', 'audio/mpeg');

              // Step 4: Convert GPT response to TTS audio and stream it to the client
              await streamTextToSpeech(gptResponse, res);

              // Cleanup: Delete the audio file after processing
              fs.unlink(newFilePath, (err) => {
                if (err) console.error('Failed to delete file:', err);
              });
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