import fs from "fs";

const filePath = "C:/Users/SGSey/.gemini/antigravity/brain/537a8be5-3f3f-417d-b016-7debcea09c72/.system_generated/steps/175/content.md";
const html = fs.readFileSync(filePath, "utf-8");

// Search for schema.org/Recipe JSON-LD
const scriptMatches = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
console.log("Total ld+json script tags found:", scriptMatches ? scriptMatches.length : 0);

if (scriptMatches) {
  for (const tag of scriptMatches) {
    const jsonStr = tag.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try {
      const parsed = JSON.parse(jsonStr);
      const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
      for (const item of items) {
        if (item["@type"] === "Recipe" || (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))) {
          console.log("\n================ FOUND RECIPE ================");
          console.log("Name:", item.name);
          console.log("Yield:", item.recipeYield);
          console.log("Ingredients:", JSON.stringify(item.recipeIngredient, null, 2));
          fs.writeFileSync("preppy_key_lime_pie.json", JSON.stringify(item, null, 2));
          console.log("\nSaved to preppy_key_lime_pie.json!");
        }
      }
    } catch (e) {
      // ignore non-json
    }
  }
}
