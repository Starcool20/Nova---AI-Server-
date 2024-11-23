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

// Function to get GPT-generated response based on transcription
async function getGPTResponse(audioData, res) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-audio-preview',
      modalities: ["text", "audio"],
      audio: { voice: "alloy", format: "mp3" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", "text": "You are an assistant named Nova, respond as assistant according to the recording." },
            {
              type: "input_audio",
              input_audio: {
                data: audioData,
                format: "mp3"
              }
            }
          ]
        }
    ],
      frequency_penalty: 2.0,
      presence_penalty: 2.0,
      temperature: 1,
      max_completion_tokens: 4095,
    });

    // Decode the base64 data to an ArrayBuffer
    const audio = base64ToArrayBuffer(response.choices[0].message.audio.data);

    // Convert ArrayBuffer to Buffer
    const buffer = Buffer.from(audio);

    res.write(buffer);

    // End the response once all chunks are sent
    res.end();
  } catch (e) {
    console.error('Error streaming text to speech:', e);
    res.status(500).send('Internal Server Error');
  }
}

function audioFileToBase64(filePath) {
  try {
    // Read the file as a binary buffer
    const fileBuffer = fs.readFileSync(filePath);
    // Convert the buffer to a Base64 string
    const base64String = fileBuffer.toString('base64');
    return base64String;
  } catch (error) {
    console.error('Error reading the file:', error);
    throw error;
  }
}



// Main endpoint to handle audio upload, transcription, GPT response, and TTS streaming
app.post('/prompt-nova', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      console.error('No file received in the request');
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const originalFilePath = path.join('/tmp', req.file.filename);

    const newFilename = `nova.mp3`; // Customize your new filename as needed
    const newFilePath = path.join('/tmp', newFilename);

    // Rename the file
    fs.rename(originalFilePath, newFilePath, async (err) => {
      if (err) {
        console.error('Error renaming file:', err);
        return res.status(500).json({ error: 'Failed to rename file' });
      }

      const dataAudio = audioFileToBase64(newFilePath);
      // Step 3: Set response headers for streaming audio
      res.setHeader('Content-Type', 'audio/mpeg');

      // Step 2: Generate response using GPT based on the transcription
      const gptResponse = await getGPTResponse(dataAudio, res);

      console.log(gptResponse);

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

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64); // Decode base64 to binary string
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Start server (for local testing only; Vercel will handle deployment)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = allowCors(handler);