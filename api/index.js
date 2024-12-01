const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const OpenAI = require("openai");
const { Readable } = require('stream');

const app = express();
const ffmpegPath = path.join(__dirname, 'bin', 'ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
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

function convertAudio(inputPath, outputPath, format) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat(format) // 'mp3' or 'wav'
      .on('error', (err) => {
        console.error('Error during conversion:', err.message);
        reject(err);
      })
      .on('end', () => {
        console.log('Conversion finished:', outputPath);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

// Function to get GPT-generated response based on transcription
async function getGPTResponse(audioData, res) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-audio-preview',
      modalities: ["text", "audio"],
      audio: { voice: "alloy", format: "mp3" },
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "You are an assistant named Nova, respond as an assistant according to the recording or Output {no speech} if there isn't no human voice."
        }
      ],
          role: "user",
          content: [
            {
              type: "text",
              text: ""
            },
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
      temperature: 0.2,
      max_completion_tokens: 200,
    });

    // Decode the base64 data to an ArrayBuffer
    const audio = base64ToArrayBuffer(response.choices[0].message.audio.data);

    const text = response.choices[0].message.audio.transcript;
    console.log(text);

    if (text.toLowerCase() === '{no speech}') {
      res.setHeader('Content-Type', 'text/plain');
      res.status(200).send(text);
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');

    // Convert ArrayBuffer to Buffer
    const buffer = Buffer.from(audio);

    res.write(buffer);

    // End the response once all chunks are sent
    res.status(200).end();
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

    const outputPath = path.join('/tmp', 'nova.mp4');

    const newFilePath = path.join('/tmp', 'nova.mp3');

    fs.rename(originalFilePath, outputPath, (err) => {
      if (err) {
        console.error('Error writing to file:', err);
      } else {
        console.log('File written successfully!');
      }
    });

    await convertAudio(outputPath, newFilePath, 'mp3');

    const dataAudio = audioFileToBase64(newFilePath);

    // Step 2: Generate response using GPT based on the transcription
    const gptResponse = await getGPTResponse(dataAudio, res);

    // Cleanup: Delete the audio file after processing
    fs.unlink(newFilePath, (err) => {
      if (err) console.error('Failed to delete file:', err);
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