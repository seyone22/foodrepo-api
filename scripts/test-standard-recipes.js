// Standardized regression test suite for the 3 Preppy Kitchen recipes:
// 1. Chili (https://preppykitchen.com/chili-recipe/)
// 2. Apple Pie (https://preppykitchen.com/apple-pie/)
// 3. Mud Pie (https://preppykitchen.com/mud-pie/)
require('dotenv').config();
const postgres = require('postgres');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is required.');
  process.exit(1);
}
const sql = postgres(databaseUrl);

async function runStandardTests() {
  console.log('Running Standardized Recipe Regression Test Suite...\n');

  let failureCount = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`FAIL: ${message}`);
      failureCount++;
    } else {
      console.log(`PASS: ${message}`);
    }
  }

  try {
    // 1. Database Check: Multi-mapping constraint exists
    const constraintRes = await sql`
      SELECT conname FROM pg_constraint 
      WHERE conrelid = 'foodrepo.mappings'::regclass 
        AND conname = 'mappings_single_matched_ingredient_check';
    `;
    assert(constraintRes.length === 1, 'Database constraint mappings_single_matched_ingredient_check is active');

    // 2. Check that no records violate single ingredient mapping
    const multiMapRes = await sql`
      SELECT count(*) as count FROM foodrepo.mappings WHERE cardinality(matched_ingredients) > 1;
    `;
    assert(parseInt(multiMapRes[0].count, 10) === 0, 'Zero multi-mapped product records in foodrepo.mappings');

    // 3. Recipe 1: Apple Pie Checks
    console.log('\n--- Checking Recipe: Apple Pie (https://preppykitchen.com/apple-pie/) ---');
    
    // Check apple varieties
    const appleIngRes = await sql`
      SELECT varieties FROM foodrepo.ingredients WHERE name = 'apple';
    `;
    const appleVarieties = appleIngRes[0]?.varieties || [];
    assert(!appleVarieties.includes('wood apple'), 'Apple varieties does not include wood apple');
    assert(!appleVarieties.includes('custard apple'), 'Apple varieties does not include custard apple');
    assert(!appleVarieties.includes('rose apple'), 'Apple varieties does not include rose apple');
    assert(!appleVarieties.includes('lemonade'), 'Apple varieties does not include lemonade');
    assert(appleVarieties.includes('green apple') || appleVarieties.includes('granny smith apple'), 'Apple varieties includes green apple or granny smith apple');

    // Check sugar decoupling from tea
    const teaRes = await sql`
      SELECT part_of FROM foodrepo.ingredients WHERE name = 'tea';
    `;
    const teaParts = teaRes[0]?.part_of || [];
    assert(!teaParts.includes('sugar'), 'Tea does not contain sugar in part_of');

    // Check granulated sugar mapping
    const granSugarRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%granulated sugar%' OR i.name ILIKE '%white sugar%' OR i.name = 'sugar';
    `;
    const granSugarProducts = granSugarRes.map(r => r.name.toLowerCase());
    const hasTeaBun = granSugarProducts.some(name => name.includes('tea bun'));
    assert(!hasTeaBun, 'Granulated/white sugar does NOT map to Keells Tea Bun');
    assert(granSugarProducts.length > 0, `Sugar maps to authentic sugar products (${granSugarProducts.length} mapped)`);

    // Check butter 1:1 mapping
    const butterRes = await sql`
      SELECT m.product_id, p.name, m.matched_ingredients, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%butter%';
    `;
    assert(butterRes.length > 0, `Butter has mapped products (${butterRes.length} mapped)`);
    const multiMappedButter = butterRes.filter(r => r.matched_ingredients.length > 1);
    assert(multiMappedButter.length === 0, 'No butter product is multi-mapped');

    // 4. Recipe 2: Chili Checks
    console.log('\n--- Checking Recipe: Chili (https://preppykitchen.com/chili-recipe/) ---');
    // Ground beef
    const beefRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%beef%';
    `;
    assert(beefRes.length > 0, `Beef/ground beef has mapped supermarket products (${beefRes.length} mapped)`);

    // Red kidney beans
    const beanRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%kidney bean%';
    `;
    assert(beanRes.length > 0, `Kidney beans have mapped products (${beanRes.length} mapped)`);

    // Chili powder
    const chiliPowderRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'chili powder';
    `;
    assert(chiliPowderRes.length > 0, `Chili powder has mapped products (${chiliPowderRes.length} mapped)`);
    const noSauceInPowder = chiliPowderRes.every(r => !r.name.toLowerCase().includes('chilli sauce'));
    assert(noSauceInPowder, 'Chili powder products do not match chilli sauce');

    // 5. Recipe 3: Mud Pie Checks
    console.log('\n--- Checking Recipe: Mud Pie (https://preppykitchen.com/mud-pie/) ---');
    // Oreo cookies
    const oreoRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%oreo%' OR i.name ILIKE '%cookie%';
    `;
    assert(oreoRes.length > 0, `Oreo/Chocolate sandwich cookies have mapped products (${oreoRes.length} mapped)`);

    // Vanilla extract
    const vanillaRes = await sql`
      SELECT m.product_id, p.name, p.price, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%vanilla%';
    `;
    assert(vanillaRes.length > 0, `Vanilla extract has mapped products (${vanillaRes.length} mapped)`);

    // Heavy cream
    const creamRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%cream%';
    `;
    assert(creamRes.length > 0, `Heavy/whipping cream has mapped products (${creamRes.length} mapped)`);

    // 6. Recipe 4: Brownie Recipe Checks
    console.log('\n--- Checking Recipe: Brownies (https://preppykitchen.com/brownie-recipe/) ---');
    // Cocoa powder
    const cocoaRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%cocoa powder%' OR i.name ILIKE '%cacao%';
    `;
    assert(cocoaRes.length > 0, `Cocoa powder has mapped products (${cocoaRes.length} mapped)`);

    // Chocolate chips
    const chocoChipsRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%chocolate chip%' OR i.name ILIKE '%chocolate button%';
    `;
    assert(chocoChipsRes.length > 0, `Chocolate chips/buttons have mapped products (${chocoChipsRes.length} mapped)`);

    // 7. Recipe 5: Millionaires Shortbread Checks
    console.log('\n--- Checking Recipe: Millionaires Shortbread (https://preppykitchen.com/millionaires-shortbread/) ---');
    // Condensed milk
    const condMilkRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%condensed milk%';
    `;
    assert(condMilkRes.length > 0, `Condensed milk has mapped products (${condMilkRes.length} mapped)`);

    // Corn syrup / Glucose syrup / Baking syrup (exclude cough syrups)
    const syrupRes = await sql`
      SELECT p.id, p.name
      FROM foodrepo.products p
      WHERE p.name ILIKE '%glucose syrup%' OR p.name ILIKE '%liquid glucose%' OR p.name ILIKE '%treacle%';
    `;
    assert(syrupRes.length > 0, `Baking syrups / treacle are present in supermarket catalogs (${syrupRes.length} items)`);
    const noCoughSyrupInFood = syrupRes.every(p => !p.name.toLowerCase().includes('cough'));
    assert(noCoughSyrupInFood, 'Syrup food candidates exclude cough syrup');

    // 8. Recipe 6: Apple Cobbler Checks
    console.log('\n--- Checking Recipe: Apple Cobbler (https://preppykitchen.com/apple-cobbler/) ---');
    // Cornstarch / corn flour
    const cornstarchRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%cornstarch%' OR i.name ILIKE '%corn flour%';
    `;
    assert(cornstarchRes.length > 0, `Cornstarch / corn flour has mapped products (${cornstarchRes.length} mapped)`);

    // Fresh milk / whole milk
    const milkRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'milk' OR i.name ILIKE '%fresh milk%';
    `;
    assert(milkRes.length > 0, `Fresh milk / whole milk has mapped products (${milkRes.length} mapped)`);

    // 9. Recipe 7: Quiche Recipe Checks
    console.log('\n--- Checking Recipe: Quiche (https://preppykitchen.com/quiche-recipe/) ---');
    // Ham / cooked ham
    const hamRes = await sql`
      SELECT m.product_id, p.name, i.name as ing_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name ILIKE '%ham%';
    `;
    assert(hamRes.length > 0, `Ham has mapped products (${hamRes.length} mapped)`);

    // Cheese / Swiss cheese
    const cheeseRes = await sql`
      SELECT p.id, p.name, p.price
      FROM foodrepo.products p
      WHERE (p.name ILIKE '%cheese block%' OR p.name ILIKE '%swiss%' OR p.name ILIKE '%cheddar%')
        AND p.price > 0;
    `;
    assert(cheeseRes.length > 0, `Authentic cheese blocks with price > 0 exist (${cheeseRes.length} items)`);

    // 10. Recipe 8: Pasta Carbonara Checks
    console.log('\n--- Checking Recipe: Pasta Carbonara (https://preppykitchen.com/pasta-carbonara/) ---');
    const spaghettiRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%spaghetti%';
    `;
    assert(spaghettiRes.length > 0, `Spaghetti has mapped products (${spaghettiRes.length} mapped)`);

    const baconRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%bacon%';
    `;
    assert(baconRes.length > 0, `Bacon has mapped products (${baconRes.length} mapped)`);

    const parmRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%parmesan%';
    `;
    assert(parmRes.length > 0, `Parmesan cheese has mapped products (${parmRes.length} mapped)`);

    // 11. Recipe 9: Apple Strudel Checks
    console.log('\n--- Checking Recipe: Apple Strudel (https://preppykitchen.com/apple-strudel/) ---');
    const puffRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%puff pastry%';
    `;
    assert(puffRes.length > 0, `Puff pastry has mapped products (${puffRes.length} mapped)`);

    const raisinRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%raisin%';
    `;
    assert(raisinRes.length > 0, `Raisins have mapped products (${raisinRes.length} mapped)`);

    // 12. Recipe 10: Hash Browns Checks
    console.log('\n--- Checking Recipe: Hash Browns (https://preppykitchen.com/hash-browns/) ---');
    const potatoRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%potato%' AND p.name NOT ILIKE '%sweet potato%';
    `;
    assert(potatoRes.length > 0, `Table potatoes have mapped products (${potatoRes.length} mapped)`);

    const onionPowderRes = await sql`
      SELECT p.id, p.name
      FROM foodrepo.products p
      WHERE p.name ILIKE '%onion powder%';
    `;
    assert(onionPowderRes.length > 0, `Onion powder exists in catalog (${onionPowderRes.length} items)`);

    // 13. Recipe 11: English Tea Sandwiches Checks
    console.log('\n--- Checking Recipe: English Tea Sandwiches (https://preppykitchen.com/english-tea-sandwiches/) ---');
    const teaBreadRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'bread' AND (p.name ILIKE '%sandwich bread%' OR p.name ILIKE '%white bread%');
    `;
    assert(teaBreadRes.length > 0, `Bread maps to authentic sandwich/white bread (${teaBreadRes.length} mapped)`);

    const dijonRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'dijon mustard';
    `;
    assert(dijonRes.length > 0, `Dijon mustard maps to authentic dijon products (${dijonRes.length} mapped)`);

    const noToothpaste = await sql`
      SELECT count(*) as count
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%tooth paste%' OR p.name ILIKE '%toothpaste%';
    `;
    assert(parseInt(noToothpaste[0].count, 10) === 0, 'Zero toothpaste products mapped in database');

    // 14. Recipe 12: Baked Sole Checks
    console.log('\n--- Checking Recipe: Baked Sole (https://preppykitchen.com/baked-sole/) ---');
    const soleRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'sole';
    `;
    assert(soleRes.length > 0, `Sole has mapped white fish fillet products (${soleRes.length} mapped)`);

    const worcRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'worcestershire sauce';
    `;
    assert(worcRes.length > 0, `Worcestershire sauce has mapped products (${worcRes.length} mapped)`);

    // 15. Recipe 13: Brown Sugar Salmon Checks
    console.log('\n--- Checking Recipe: Brown Sugar Salmon (https://preppykitchen.com/brown-sugar-salmon/) ---');
    const radishRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'radish';
    `;
    assert(radishRes.length > 0, `Radish maps to authentic supermarket raddish products (${radishRes.length} mapped)`);

    const arugulaRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'arugula';
    `;
    assert(arugulaRes.length > 0, `Arugula maps to rocket lettuce (${arugulaRes.length} mapped)`);

    const soySauceRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'soy sauce';
    `;
    assert(soySauceRes.length > 0, `Soy sauce has mapped products (${soySauceRes.length} mapped)`);

    const sesameOilRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'sesame oil';
    `;
    assert(sesameOilRes.length > 0, `Sesame oil has mapped products (${sesameOilRes.length} mapped)`);

    const noPetSalmon = await sql`
      SELECT count(*) as count
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      WHERE p.name ILIKE '%drools%' OR p.name ILIKE '%cat salmon%' OR p.name ILIKE '%whiskas%';
    `;
    assert(parseInt(noPetSalmon[0].count, 10) === 0, 'Zero pet food products mapped in database');

    // 17. Recipe 14: Beef & Broccoli / Asian Stir-Fry Checks (Oyster Sauce vs Oyster Mushroom)
    console.log('\n--- Checking Recipe: Stir Fry / Oyster Sauce Fidelity ---');
    const oysterSauceRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'oyster sauce';
    `;
    assert(oysterSauceRes.length > 0, `Oyster sauce has mapped products (${oysterSauceRes.length} mapped)`);

    const noMushroomInSauce = oysterSauceRes.filter(r => r.name.toLowerCase().includes('mushroom'));
    assert(noMushroomInSauce.length === 0, 'Zero mushroom products mapped to oyster sauce');

    const oysterMushroomRes = await sql`
      SELECT m.product_id, p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'oyster mushroom';
    `;
    assert(oysterMushroomRes.length > 0, `Oyster mushroom has mapped products (${oysterMushroomRes.length} mapped)`);

    const noSauceInMushroom = oysterMushroomRes.filter(r => r.name.toLowerCase().includes('sauce'));
    assert(noSauceInMushroom.length === 0, 'Zero sauce products mapped to oyster mushroom');

    const noMushroomInOyster = await sql`
      SELECT p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'oyster' AND (p.name ILIKE '%mushroom%' OR p.name ILIKE '%sauce%');
    `;
    assert(noMushroomInOyster.length === 0, 'Zero mushroom or sauce products mapped to shellfish oyster');

    // 18. Recipe 15: Chinese Soy Sauce Chicken Checks
    console.log('\n--- Checking Recipe: Chinese Soy Sauce Chicken ---');

    // 18.1 Neutral cooking oil fidelity (zero lamp wicks, zero castor oil)
    const badOilMappings = await sql`
      SELECT p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name IN ('neutral oil', 'vegetable oil', 'sunflower oil', 'cooking oil')
        AND (p.name ILIKE '%wick%' OR p.name ILIKE '%castor%' OR p.name ILIKE '%lamp%');
    `;
    assert(badOilMappings.length === 0, 'Zero lamp wicks or castor oil mapped to cooking oils');

    // 18.2 Chicken bouillon/stock fidelity (zero spicy wings or raw chicken cuts)
    const badBouillonMappings = await sql`
      SELECT p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name IN ('chicken base', 'chicken bouillon', 'bouillon', 'stock cube')
        AND (p.name ILIKE '%spicy wings%' OR p.name ILIKE '%drumstick%' OR p.name ILIKE '%curry cut%');
    `;
    assert(badBouillonMappings.length === 0, 'Zero chicken meat cuts mapped to chicken bouillon/stock cubes');

    // 18.3 Whole chicken fidelity (zero coating mixes or flour mixes)
    const badChickenMappings = await sql`
      SELECT p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'chicken'
        AND (p.name ILIKE '%crispy fried chicken mix%' OR p.name ILIKE '%coating mix%');
    `;
    assert(badChickenMappings.length === 0, 'Zero coating or flour mixes mapped to raw whole chicken');

    // 18.4 Chinese cooking wine fidelity (zero cabbage, zero biscuits, zero vinegar)
    const badWineMappings = await sql`
      SELECT p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name IN ('shaoxing wine', 'chinese rose wine', 'cooking wine')
        AND (p.name ILIKE '%cabbage%' OR p.name ILIKE '%biscuit%' OR p.name ILIKE '%vinegar%');
    `;
    assert(badWineMappings.length === 0, 'Zero vegetables, biscuits, or vinegar mapped to cooking wine');

    // 18.5 Water fidelity (zero ice corn confections or mattresses)
    const badWaterMappings = await sql`
      SELECT p.name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
      WHERE i.name = 'water'
        AND (p.name ILIKE '%ice corn%' OR p.name ILIKE '%mattress%' OR p.name ILIKE '%heater%');
    `;
    assert(badWaterMappings.length === 0, 'Zero ice confections, mattresses, or heaters mapped to water');

    console.log(`\n========================================`);
    if (failureCount === 0) {
      console.log(`ALL 15 STANDARDIZED RECIPE TESTS PASSED (0 failures)`);
    } else {
      console.error(`STANDARDIZED RECIPE TESTS FAILED with ${failureCount} failure(s)! STOPPING.`);
    }
    console.log(`========================================\n`);

  } catch (err) {
    console.error('Error running test suite:', err);
    failureCount++;
  } finally {
    await sql.end();
    if (failureCount > 0) {
      process.exit(1);
    }
  }
}

runStandardTests();
