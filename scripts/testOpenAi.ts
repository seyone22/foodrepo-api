import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";

async function testKeys() {
  console.log("Checking OpenAI / Gemini API Keys...");
  console.log("OPENAI_API_KEY prefix:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 8) : "None");
  console.log("GEMINI_API_KEY prefix:", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(0, 8) : "None");

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.models.list();
    console.log("✅ OpenAI API Key works! Available models:", response.data.length);
  } catch (err: any) {
    console.error("❌ OpenAI API Error:", err.message);
  }
}

testKeys();
