import fs from "fs";
import path from "path";

async function main() {
  const filePath = path.join(
    __dirname,
    "../public/FoodData_Central_foundation_food_json_2026-04-30.json",
  );
  if (!fs.existsSync(filePath)) {
    console.error("File does not exist at:", filePath);
    return;
  }

  const rawData = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(rawData);
  const foods = parsed.FoundationFoods || [];

  console.log(`Total Foundation Foods: ${foods.length}`);
  console.log("\nFirst 10 foods in the dataset:");
  foods.slice(0, 10).forEach((f: any, i: number) => {
    console.log(
      `${i + 1}. [FDC ID: ${f.fdcId}] ${f.description} (${f.foodCategory?.description})`,
    );
  });
}

main().catch(console.error);
