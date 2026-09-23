// utils/normalizeQuantityUnit.ts

export interface NormalizedQtyUnit {
  quantity: number;
  unit: string;
}

/**
 * Extracts meaningful quantity and unit from raw supermarket product data.
 * Handles broken feeds like Keells: "NO" units, missing units, 0.4 KG, quantities in name, and multi-packs.
 * Supports store-specific structured metadata such as Cargills UnitSize and UOM.
 * Normalizes all weights to grams, volumes to milliliters, and units to "unit" for pieces.
 */
export function normalizeQuantityUnit(raw: any): NormalizedQtyUnit {
  let quantity = 1;
  let unit = typeof raw === "object" && raw?.unit ? raw.unit.toLowerCase() : "";

  const nameStr =
    typeof raw === "string"
      ? raw
      : raw?.name || raw?.title || raw?.ItemName;

  if (!nameStr) {
    throw new Error(
      `Missing name or title in raw object! Received:\n${JSON.stringify(raw, null, 2)}`,
    );
  }

  const name = nameStr.toLowerCase();

  // Dedicated normalization for whole poultry eggs (loose & multi-packs)
  const isNonWholeEggProduct =
    /\b(noodles?|pasta|spaghetti|powder|seasoning|crisps?|chips?|shampoo|biscuit|cookie|cracker|mayo|mayonnaise|sauce|colour|coloring)\b/i.test(
      name,
    );
  const isEggProduct = /\beggs?\b/i.test(name) && !isNonWholeEggProduct;
  if (isEggProduct) {
    const eggCountMatch =
      name.match(/\b(30|15|12|10|6)\s*(?:'s|s|pack|pkt|pcs)\b/i) ||
      name.match(/\b(?:pack|pkt)\s*of\s*(30|15|12|10|6)\b/i) ||
      name.match(/\b(30|15|12|10|6)\b/);

    if (eggCountMatch) {
      return { quantity: parseInt(eggCountMatch[1], 10), unit: "unit" };
    }

    if (/\bbulk\b/i.test(name) || raw?.uom === "NO" || raw?.uom === "EA") {
      return { quantity: 1, unit: "unit" };
    }

    const rawUnitSize = raw?.UnitSize ? parseInt(raw.UnitSize, 10) : null;
    if (rawUnitSize && rawUnitSize > 1) {
      return { quantity: rawUnitSize, unit: "unit" };
    }

    return { quantity: 10, unit: "unit" };
  }

  // Dedicated normalization for whole coconuts (pol, thambili)
  const isNonWholeCoconutProduct =
    /\b(oil|milk|powder|cream|flour|sugar|treacle|vinegar|water|nectar|aminos|honey|syrup|butter|spread|jaggery|paste|scraped|grated|shredded|desiccated|sambol|chutney|chips?|biscuit|cookie|chocolate|toffee|soap|shampoo|lotion|scrub|conditioner|scraper|shell|charcoal)\b/i.test(
      name,
    );
  const isWholeCoconut =
    /\b(coconuts?|pol|thambili)\b/i.test(name) && !isNonWholeCoconutProduct;
  if (isWholeCoconut) {
    const packMatch =
      name.match(/\b(?:pack|pkt)\s*of\s*(\d+)\b/i) ||
      name.match(/\b(\d+)\s*(?:'s|s|pack|pkt|pcs)\b/i);
    if (packMatch) {
      return { quantity: parseInt(packMatch[1], 10), unit: "unit" };
    }

    const rawUnitSize = raw?.UnitSize ? parseInt(raw.UnitSize, 10) : null;
    if (rawUnitSize && rawUnitSize > 1) {
      return { quantity: rawUnitSize, unit: "unit" };
    }

    return { quantity: 1, unit: "unit" };
  }

  // Handle multi-packs in title, e.g., "2x400g", "6 pack of 330ml"
  const multiPackMatch = name.match(
    /(\d+)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l)/i,
  );
  if (multiPackMatch) {
    const packCount = parseFloat(multiPackMatch[1]);
    const packQty = parseFloat(multiPackMatch[2]);
    const packUnit = multiPackMatch[3].toLowerCase();

    switch (packUnit) {
      case "g":
        quantity = packCount * packQty;
        unit = "g";
        break;
      case "kg":
        quantity = packCount * packQty * 1000;
        unit = "g";
        break;
      case "ml":
        quantity = packCount * packQty;
        unit = "ml";
        break;
      case "l":
        quantity = packCount * packQty * 1000;
        unit = "ml";
        break;
      default:
        quantity = packCount * packQty;
        unit = packUnit;
    }
    return { quantity, unit };
  }

  // Handle reverse multi-packs in title, e.g., "6G*25S", "2g*20 tea bags", "100g x 4"
  const reverseMultiPackMatch = name.match(
    /(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\s*[xX*]\s*(\d+)(?:\s*(?:'s|s|pcs?|pkts?|bags?|sachets?))?\b/i,
  );
  if (reverseMultiPackMatch) {
    const packQty = parseFloat(reverseMultiPackMatch[1]);
    const packUnit = reverseMultiPackMatch[2].toLowerCase();
    const packCount = parseFloat(reverseMultiPackMatch[3]);

    switch (packUnit) {
      case "g":
        quantity = packCount * packQty;
        unit = "g";
        break;
      case "kg":
        quantity = packCount * packQty * 1000;
        unit = "g";
        break;
      case "ml":
        quantity = packCount * packQty;
        unit = "ml";
        break;
      case "l":
        quantity = packCount * packQty * 1000;
        unit = "ml";
        break;
      default:
        quantity = packCount * packQty;
        unit = packUnit;
    }
    return { quantity, unit };
  }

  // Handle simple explicit quantity in name, e.g., "400g", "1kg", "500ml"
  const qtyMatch = name.match(
    /(\d+(?:\.\d+)?)\s*(g|kg|ml|l|ltrs?|pack|pcs|piece|bottle|bag)/i,
  );
  if (qtyMatch) {
    const parsedQty = parseFloat(qtyMatch[1]);
    const parsedUnit = qtyMatch[2].toLowerCase();

    switch (parsedUnit) {
      case "g":
        quantity = parsedQty;
        unit = "g";
        break;
      case "kg":
        quantity = parsedQty * 1000;
        unit = "g";
        break;
      case "ml":
        quantity = parsedQty;
        unit = "ml";
        break;
      case "l":
      case "ltr":
      case "ltrs":
        quantity = parsedQty * 1000;
        unit = "ml";
        break;
      case "pack":
      case "pcs":
      case "piece":
      case "bottle":
      case "bag":
        quantity = parsedQty;
        unit = "unit";
        break;
      default:
        quantity = parsedQty;
        unit = parsedUnit;
    }
    return { quantity, unit };
  }

  // Structured store metadata check (e.g. Cargills UnitSize and UOM)
  // When the item name has no weight substring, use explicit backend attributes.
  if (typeof raw === "object" && raw !== null) {
    const rawUnitSize = raw.UnitSize !== undefined && raw.UnitSize !== null ? parseFloat(raw.UnitSize) : null;
    const rawUom = raw.UOM ? String(raw.UOM).toLowerCase().trim() : "";

    if (rawUnitSize && !isNaN(rawUnitSize) && rawUnitSize > 0 && rawUom) {
      switch (rawUom) {
        case "g":
        case "gr":
          return { quantity: rawUnitSize, unit: "g" };
        case "kg":
          return { quantity: rawUnitSize * 1000, unit: "g" };
        case "ml":
          return { quantity: rawUnitSize, unit: "ml" };
        case "l":
        case "lt":
          return { quantity: rawUnitSize * 1000, unit: "ml" };
        case "pcs":
        case "pc":
        case "each":
        case "s":
        case "pkt":
          return { quantity: rawUnitSize, unit: "unit" };
        default:
          return { quantity: rawUnitSize, unit: rawUom };
      }
    }

    // Fallback: Check raw.SearchTerm for embedded package size patterns (e.g. ",250g,", "- 500g")
    const searchTerm = raw.SearchTerm || raw.search_terms;
    if (typeof searchTerm === "string" && searchTerm.trim()) {
      const termMatch = searchTerm.match(
        /(?:^|[,\s\-_])(\d+(?:\.\d+)?)\s*(g|kg|ml|l|ltrs?|pcs?|each)(?:$|[,\s\-_])/i,
      );
      if (termMatch) {
        const parsedTermQty = parseFloat(termMatch[1]);
        const parsedTermUnit = termMatch[2].toLowerCase();

        switch (parsedTermUnit) {
          case "g":
            return { quantity: parsedTermQty, unit: "g" };
          case "kg":
            return { quantity: parsedTermQty * 1000, unit: "g" };
          case "ml":
            return { quantity: parsedTermQty, unit: "ml" };
          case "l":
          case "ltr":
          case "ltrs":
            return { quantity: parsedTermQty * 1000, unit: "ml" };
          case "pc":
          case "pcs":
          case "each":
            return { quantity: parsedTermQty, unit: "unit" };
        }
      }
    }
  }

  // Heuristics for broken or structured fields
  if (raw?.quantity && typeof raw.quantity === "number" && raw.quantity > 0) {
    if (unit === "kg") {
      quantity = raw.quantity * 1000;
      unit = "g";
    } else if (unit === "l" || unit === "lt") {
      quantity = raw.quantity * 1000;
      unit = "ml";
    } else if (unit === "g" || unit === "ml") {
      quantity = raw.quantity;
    } else if (unit === "no" || unit === "ea" || unit === "unit" || unit === "pcs") {
      quantity = raw.quantity;
      unit = "unit";
    } else if (!unit || unit === "") {
      quantity = raw.quantity * 1000;
      unit = "g";
    }
  } else if (unit === "no" || unit === "ea") {
    quantity = 1;
    unit = "unit";
  }

  // Fallback for completely missing or empty unit
  if (!unit || unit === "") {
    unit = "kg";
    quantity = quantity * 1;
  }

  return { quantity, unit };
}

/**
 * Normalizes various price formats to a clean number (double).
 */
export function normalizePrice(raw: any): number {
  if (raw == null) return 0;

  if (typeof raw === "number" && !isNaN(raw)) {
    return raw;
  }

  const str = String(raw)
    .replace(/[^\d.,]/g, "")
    .replace(/,/g, "");

  const parsed = parseFloat(str);

  if (isNaN(parsed)) {
    console.warn(`normalizePrice: failed to parse price from "${raw}"`);
    return 0;
  }

  return parsed;
}
