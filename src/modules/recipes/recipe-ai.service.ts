import { GoogleGenAI } from "@google/genai";
import { Injectable } from "@nestjs/common";

@Injectable()
export class RecipeAiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  async parseCameraRecipe(rawText: string): Promise<string | null> {
    if (!this.ai) {
      console.warn("GEMINI_API_KEY is not defined in environment");
      return null;
    }

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a culinary assistant extracting structured recipes.
Extract the recipe title, yield/servings, and an array of raw ingredient strings from the following recipe text or HTML.
Return strictly valid JSON with this shape:
{
  "name": "string",
  "recipeYield": 4,
  "recipeIngredient": ["1 cup flour", "2 eggs"]
}

Recipe content:
${rawText}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });

      return response.text ?? null;
    } catch (error) {
      console.error("Gemini recipe parsing error:", error);
      return null;
    }
  }

  async parseIngredientsToSchemaOrg(
    ingredientLines: string[],
  ): Promise<
    Array<{
      name: string;
      quantity?: { value: number; unitText: string };
    }>
  > {
    if (!this.ai) {
      return ingredientLines.map((line) => ({
        name: line.replace(/^[\d./\s]+(cups?|tbsp|tsp|g|kg|ml|l|cans?|packs?|pinch|to taste)?\s*(of\s*)?/i, "").trim(),
        quantity: { value: 1, unitText: "unit" },
      }));
    }

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are a culinary data parsing assistant.
Given this array of raw recipe ingredient lines:
${JSON.stringify(ingredientLines, null, 2)}

Parse each line into standard culinary components:
- name: The pure, standardized ingredient name (without quantities or prep notes like "diced", "chopped", "melted", "softened", "freshly squeezed").
- quantity: An object with numeric "value" and standardized "unitText" (e.g. "g", "kg", "ml", "l", "cup", "tbsp", "tsp", "can", "unit").
If no quantity is found, default to value: 1, unitText: "unit".

Return strictly a JSON array of objects:
[
  {
    "name": "unsalted butter",
    "quantity": { "value": 6, "unitText": "tbsp" }
  }
]`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI");
      return JSON.parse(text);
    } catch (err) {
      console.warn("AI ingredient parsing failed, using fallback:", err);
      return ingredientLines.map((line) => ({
        name: line.replace(/^[\d./\s]+(cups?|tbsp|tsp|g|kg|ml|l|cans?|packs?|pinch|to taste)?\s*(of\s*)?/i, "").trim(),
        quantity: { value: 1, unitText: "unit" },
      }));
    }
  }

  async parseIngredients(ingredientList: string[]): Promise<
    Array<{
      ingredient: string;
      quantity: number | null;
      unit: string | null;
      notes: string | null;
    }>
  > {
    if (!ingredientList.length) return [];
    if (!this.ai) {
      return ingredientList.map((line) => ({
        ingredient: line,
        quantity: null,
        unit: null,
        notes: null,
      }));
    }

    const prompt = `Extract structured data from this ingredient list. Return a JSON Array of objects.
Fields: "ingredient" (string), "quantity" (number, null if missing), "unit" (string, null if missing), "notes" (string, null if missing).

Ingredients:
${ingredientList.join("\n")}`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ingredient: { type: "string" },
                quantity: { type: "number", nullable: true },
                unit: { type: "string", nullable: true },
                notes: { type: "string", nullable: true },
              },
              required: ["ingredient"],
            },
          },
        },
      });

      if (response.text) {
        return JSON.parse(response.text);
      }
      return [];
    } catch (err: any) {
      console.error("Failed to parse ingredients using Gemini:", err.message || err);
      throw err;
    }
  }

  async parseCameraRecipeToJsonLd(rawText: string): Promise<string | null> {
    if (!this.ai) {
      console.warn("GEMINI_API_KEY is not defined in environment");
      return null;
    }

    const prompt = `You are a recipe parsing assistant. Convert the raw text below into a valid JSON-LD Recipe object (https://schema.org/Recipe).
Strict Requirements:
- Use ISO 8601 durations for times (e.g., "PT30M").
- Do not include explanations or markdown.
- Output raw JSON only.

Raw Text:
${rawText}`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      if (response.text) {
        return response.text
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/, "")
          .replace(/```$/, "")
          .trim();
      }
      return null;
    } catch (err: any) {
      console.error("Failed to parse camera recipe using Gemini:", err.message || err);
      return null;
    }
  }
}
