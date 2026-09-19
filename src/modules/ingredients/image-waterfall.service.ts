import { Injectable } from "@nestjs/common";

export interface CulinaryImageResult {
  url: string;
  author: string;
  source: string;
}

interface ImageCandidate extends CulinaryImageResult {
  score: number;
  title: string;
}

const BAD_KEYWORDS = [
  "leaf",
  "leaves",
  "tree",
  "plant",
  "flower",
  "branch",
  "foliage",
  "botanical",
  "wild",
  "garden",
  "stem",
  "shrub",
  "grove",
];

const GOOD_KEYWORDS = [
  "spice",
  "powder",
  "cooked",
  "dish",
  "bowl",
  "ingredient",
  "sliced",
  "chopped",
  "raw",
  "fresh",
  "ground",
  "culinary",
  "isolated",
  "white background",
  "studio",
];

@Injectable()
export class ImageWaterfallService {
  private scoreCulinaryImage(
    url: string,
    title: string,
    source: string,
  ): number {
    let score = 50;
    const text = `${url} ${title}`.toLowerCase();
    for (const bad of BAD_KEYWORDS) {
      if (text.includes(bad)) score -= 35;
    }
    for (const good of GOOD_KEYWORDS) {
      if (text.includes(good)) score += 20;
    }
    if (source === "pexels" || source === "unsplash") score += 25;
    if (source === "wikimedia_commons") score += 15;
    if (source === "openfoodfacts") score += 10;
    return score;
  }

  async fetchBestCulinaryImage(
    name: string,
  ): Promise<CulinaryImageResult | null> {
    const candidates: ImageCandidate[] = [];

    // 1. PEXELS (High visual consistency)
    if (process.env.PEXELS_API_KEY) {
      try {
        const query = encodeURIComponent(`${name} spice food culinary`);
        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${query}&per_page=3&orientation=landscape`,
          {
            headers: { Authorization: process.env.PEXELS_API_KEY },
          },
        );
        if (res.ok) {
          const data = await res.json();
          for (const photo of data.photos || []) {
            if (photo?.src?.large) {
              const title = photo.alt || `${name} food photo`;
              const score = this.scoreCulinaryImage(
                photo.src.large,
                title,
                "pexels",
              );
              candidates.push({
                url: photo.src.large,
                author: `<a href="${photo.photographer_url}" target="_blank">${photo.photographer} on Pexels</a>`,
                source: "pexels",
                score,
                title,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`Pexels fetch failed for ${name}`);
      }
    }

    // 2. WIKIMEDIA COMMONS
    try {
      const query = encodeURIComponent(`${name} spice food culinary isolated`);
      const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url|user&format=json`;
      const res = await fetch(apiUrl, {
        headers: { "User-Agent": "FoodRepoBot/1.0" },
      });
      if (res.ok) {
        const data = await res.json();
        const pages = data.query?.pages || {};
        for (const key of Object.keys(pages)) {
          const info = pages[key]?.imageinfo?.[0];
          const pageTitle = pages[key]?.title || "";
          const isImage = /\.(jpe?g|png|webp|avif)(\?.*)?$/i.test(info?.url || "");
          if (info?.url && isImage) {
            const score = this.scoreCulinaryImage(
              info.url,
              pageTitle,
              "wikimedia_commons",
            );
            candidates.push({
              url: info.url,
              author: info.user || "Wikimedia Commons",
              source: "wikimedia_commons",
              score,
              title: pageTitle,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`Wikimedia Commons search failed for ${name}`);
    }

    // 3. OPEN FOOD FACTS
    try {
      const query = encodeURIComponent(name);
      const apiUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=2`;
      const res = await fetch(apiUrl, {
        headers: { "User-Agent": "FoodRepoBot/1.0 - Open Food Facts" },
      });
      if (res.ok) {
        const data = await res.json();
        for (const product of data.products || []) {
          const imgUrl = product?.image_front_url || product?.image_url;
          if (imgUrl) {
            const title = product.product_name || name;
            const score = this.scoreCulinaryImage(
              imgUrl,
              title,
              "openfoodfacts",
            );
            candidates.push({
              url: imgUrl,
              author: `Open Food Facts (${title})`,
              source: "openfoodfacts",
              score,
              title,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`Open Food Facts search failed for ${name}`);
    }

    const validCandidates = candidates.filter((c) => c.score >= 20);
    if (validCandidates.length === 0) return null;
    validCandidates.sort((a, b) => b.score - a.score);

    return {
      url: validCandidates[0].url,
      author: validCandidates[0].author,
      source: validCandidates[0].source,
    };
  }
}
