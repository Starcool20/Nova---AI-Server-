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
    temperature: '0.2',
  });
  return response.text;
}

// Function to get GPT-generated response based on transcription
async function getGPTResponse(transcription, res) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-audio-preview',
      modalities: ["text", "audio"],
      audio: { voice: "alloy", format: "pcm16" },
      messages: [
        { role: 'system', content: `Your name is now nova and you are to do this. Identify if the user input contains any instruction to stop or shut down, and if so, output the word "Stop.".
      
# Steps

1. Analyze the input message.
2. Identify if it includes any request or directive indicating a halt, stop, or shutdown.
3. If such an instruction is present, output the word "Stop. else just be an assistant then"

# Output Format

- If the instruction to stop is found, output: 'Stop'. or be an assistant where it doesn't apply.` },
        { role: 'user', content: transcription }
    ],
      frequency_penalty: 2.0,
      presence_penalty: 2.0,
      temperature: 0.2,
      max_completion_tokens: 1000,
      stream: true, 
    });
    
    console.log(response);
    
    console.log(response.delta.message);

    // Decode the base64 data to an ArrayBuffer
    const audio = base64ToArrayBuffer(response.choices[0].message.audio.data);

    // Convert ArrayBuffer to Buffer directly
    const buffer = Buffer.from(audio);

    // Write the buffer to the response
    res.write(buffer);

    // End the response
    res.end();
  } catch (e) {
    console.error('Error streaming text to speech:', e);
    res.status(500).send('Internal Server Error');
  }
}

// Function to convert GPT response to speech with streaming
async function streamTextToSpeech(gptResponse, res) {
  try {
    // Request TTS from OpenAI API
    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: gptResponse,
      response_format: 'mp3',
    });

    // Check if response is valid
    if (!ttsResponse || !ttsResponse.arrayBuffer) {
      throw new Error('Invalid TTS response');
    }


  } catch (error) {

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

    const newFilename = `nova.m4a`; // Customize your new filename as needed
    const newFilePath = path.join('/tmp', newFilename);

    // Rename the file
    fs.rename(originalFilePath, newFilePath, async (err) => {
      if (err) {
        console.error('Error renaming file:', err);
        return res.status(500).json({ error: 'Failed to rename file' });
      }

      //console.log('Uploaded file info:', newFilePath);

      // Step 1: Transcribe audio
      const transcription = await transcribeAudio(newFilePath);

      console.log(transcription);

      // Step 3: Set response headers for streaming audio
      res.setHeader('Content-Type', 'audio/mpeg');

      // Step 2: Generate response using GPT based on the transcription
      const gptResponse = await getGPTResponse(transcription, res);

      // console.log(gptResponse.message.content);

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