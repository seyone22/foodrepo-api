import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { GoogleGenAI } from "@google/genai";

async function testGeminiKey() {
  const key = process.env.GEMINI_API_KEY!;
  console.log(`Testing Gemini API Key: ${key.slice(0, 10)}...`);

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Hello, reply with 1 word.",
    });
    console.log(`✅ Model 'gemini-2.5-flash' SUCCESS! Response:`, res.text?.trim());
  } catch (err: any) {
    console.log(`❌ Model 'gemini-2.5-flash' failed:`, err.message);
  }
}

testGeminiKey();
