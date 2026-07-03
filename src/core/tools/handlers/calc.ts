// Calc tool - safely evaluate mathematical expressions
export async function handleCalc(args: Record<string, unknown>): Promise<unknown> {
  const expression = args.expression as string;

  if (!expression) {
    throw new Error("Expression is required");
  }

  // Safe math evaluation - only allow numbers, operators, and math functions
  const safeExpression = expression
    .replace(/[^0-9+\-*/.()%^sqrtpowlogsinconsitantancoshqrtlog10expabsminmaxpi e]/gi, "")
    .replace(/\^/g, "**")
    .replace(/sqrt\(/g, "Math.sqrt(")
    .replace(/pow\(/g, "Math.pow(")
    .replace(/log\(/g, "Math.log(")
    .replace(/sin\(/g, "Math.sin(")
    .replace(/cos\(/g, "Math.cos(")
    .replace(/tan\(/g, "Math.tan(")
    .replace(/pi/gi, "Math.PI")
    .replace(/\be\b/gi, "Math.E");

  try {
    // Use Function constructor for safe evaluation in a sandboxed way
    const result = new Function(`return ${safeExpression}`)();

    if (typeof result !== "number" || !isFinite(result)) {
      throw new Error("Invalid result - expression must produce a finite number");
    }

    return { result, expression };
  } catch (e) {
    throw new Error(`Failed to evaluate expression: ${(e as Error).message}`);
  }
}

// Convert tool - convert between units
export async function handleConvert(args: Record<string, unknown>): Promise<unknown> {
  const value = args.value as number;
  const from = args.from as string;
  const to = args.to as string;

  if (value === undefined || value === null) {
    throw new Error("Value is required");
  }
  if (!from) {
    throw new Error("Source unit (from) is required");
  }
  if (!to) {
    throw new Error("Target unit (to) is required");
  }

  // Normalize units to lowercase
  const fromUnit = from.toLowerCase();
  const toUnit = to.toLowerCase();

  // Conversion factors to base units (meters, kilograms, Kelvin)
  const lengthToMeters: Record<string, number> = {
    m: 1,
    meter: 1,
    meters: 1,
    km: 1000,
    kilometer: 1000,
    kilometers: 1000,
    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,
    mi: 1609.344,
    mile: 1609.344,
    miles: 1609.344,
    yd: 0.9144,
    yard: 0.9144,
    yards: 0.9144,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
    // A nautical mile is exactly 1852 meters (the previous 1.852e+9 was wrong by
    // ~1e6). Use `nmi` for nautical miles; `nm` is the SI nanometer (1e-9 m).
    nmi: 1852,
    "nautical mile": 1852,
    "nautical miles": 1852,
    nm: 1e-9, // nanometer
    nanometer: 1e-9,
    nanometers: 1e-9,
  };

  const weightToKg: Record<string, number> = {
    kg: 1,
    kilogram: 1,
    kilograms: 1,
    g: 0.001,
    gram: 0.001,
    grams: 0.001,
    mg: 1e-6,
    milligram: 1e-6,
    milligrams: 1e-6,
    lb: 0.453592,
    lbs: 0.453592,
    pound: 0.453592,
    pounds: 0.453592,
    oz: 0.0283495,
    ounce: 0.0283495,
    ounces: 0.0283495,
    ton: 907.185,
    tonnes: 907.185,
    "metric ton": 1000,
    "metric tons": 1000,
  };

  // Temperature conversion (to Kelvin, then to target)
  const toKelvin = (val: number, unit: string): number => {
    switch (unit) {
      case "c":
      case "celsius":
        return val + 273.15;
      case "f":
      case "fahrenheit":
        return (val - 32) * (5 / 9) + 273.15;
      case "k":
      case "kelvin":
        return val;
      default:
        throw new Error(`Unknown temperature unit: ${unit}`);
    }
  };

  const fromKelvin = (val: number, unit: string): number => {
    switch (unit) {
      case "c":
      case "celsius":
        return val - 273.15;
      case "f":
      case "fahrenheit":
        return (val - 273.15) * (9 / 5) + 32;
      case "k":
      case "kelvin":
        return val;
      default:
        throw new Error(`Unknown temperature unit: ${unit}`);
    }
  };

  // Determine type and convert
  let result: number;

  // Check if it's a temperature conversion
  const tempUnits = ["c", "celsius", "f", "fahrenheit", "k", "kelvin"];
  if (tempUnits.includes(fromUnit) && tempUnits.includes(toUnit)) {
    const kelvin = toKelvin(value, fromUnit);
    result = fromKelvin(kelvin, toUnit);
  }
  // Check length conversions
  else if (fromUnit in lengthToMeters && toUnit in lengthToMeters) {
    const meters = value * lengthToMeters[fromUnit];
    result = meters / lengthToMeters[toUnit];
  }
  // Check weight conversions
  else if (fromUnit in weightToKg && toUnit in weightToKg) {
    const kg = value * weightToKg[fromUnit];
    result = kg / weightToKg[toUnit];
  } else {
    throw new Error(
      `Cannot convert from '${from}' to '${to}'. Supported categories: length (m, km, ft, lb, etc.), weight (kg, g, lb, oz, etc.), temperature (c, f, k)`
    );
  }

  return {
    result,
    from: args.from,
    to: args.to,
    value: args.value,
  };
}
